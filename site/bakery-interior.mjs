const viewModule = new URL('./bakery-view.mjs', import.meta.url);
viewModule.search = new URL(import.meta.url).search;
const { bakeryView, bakeryLight } = await import(viewModule.href);

export function bakeryGeometryKey(scene) {
  let hash = 2166136261;
  for (const key of ['positions', 'normals', 'materials']) {
    const field = scene.opaque[key];
    for (const byte of new Uint8Array(field.buffer, field.byteOffset, field.byteLength)) {
      hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    }
  }
  return hash;
}

export function decodeBakeryLighting(scene, buffer) {
  const header = new DataView(buffer), count = scene.opaque.materials.length;
  if (buffer.byteLength !== 32 + count * 4 || header.getUint32(0, true) !== 0x314c4257 ||
      header.getUint32(4, true) !== count || header.getUint32(8, true) !== bakeryGeometryKey(scene) ||
      header.getUint32(24, true) !== count * 4 || header.getUint32(28, true) !== 1) {
    throw new Error('The baked bakery lighting does not match this room geometry.');
  }
  bakeryLight().direction.forEach((value, index) => {
    if (Math.abs(header.getFloat32(12 + index * 4, true) - value) > 1e-6) {
      throw new Error('The baked bakery sunlight direction is stale.');
    }
  });
  return Float32Array.from(new Uint8Array(buffer, 32), value => value / 255);
}

export function createBakeryRenderer(canvas, scene, atlas, lighting) {
  if (!(lighting instanceof Float32Array) || lighting.length !== scene.opaque.materials.length * 4 ||
      !lighting.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new Error('Matched baked bakery illumination is required.');
  }
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: true, powerPreference: 'low-power' });
  if (!gl) return null;
  const resources = [];
  function shader(type, source) {
    const result = gl.createShader(type);
    if(!result)throw new Error('Bakery scene shader allocation failed.');
    gl.shaderSource(result, source);
    gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(result);
      gl.deleteShader(result);
      throw new Error(`Bakery scene shader failed: ${error}`);
    }
    return result;
  }
  function program(vertex, fragment) {
    const result = gl.createProgram();
    if(!result)throw new Error('Bakery scene program allocation failed.');
    let v,f;
    try {
      v=shader(gl.VERTEX_SHADER,vertex);f=shader(gl.FRAGMENT_SHADER,fragment);
      gl.attachShader(result,v);gl.attachShader(result,f);gl.linkProgram(result);
      if(!gl.getProgramParameter(result,gl.LINK_STATUS))throw new Error(`Bakery scene program failed: ${gl.getProgramInfoLog(result)}`);
    } catch(error) {
      gl.deleteProgram(result);
      throw error;
    } finally {
      if(v)gl.deleteShader(v);
      if(f)gl.deleteShader(f);
    }
    resources.push(() => gl.deleteProgram(result));
    return result;
  }
  function mesh(source) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    resources.push(() => gl.deleteVertexArray(vao));
    for (const [location, field, size] of [[0,'positions',3],[1,'normals',3],[2,'uvs',2],[3,'colors',4],[4,'materials',1],[5,'lighting',4]]) {
      if (!source[field]) {
        gl.disableVertexAttribArray(location);gl.vertexAttrib4f(location,1,.2,0,.15);continue;
      }
      const buffer = gl.createBuffer();
      resources.push(() => gl.deleteBuffer(buffer));
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, source[field], gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    }
    return { vao, count: source.positions.length / 3, center: source.center || [0,0,0] };
  }
  const light = bakeryLight();
  const dispose = () => { resources.reverse().forEach(release => release()); resources.length = 0; };
  try {
    const depthProgram = program(`#version 300 es
      layout(location=0) in vec3 position;
      layout(location=4) in float material;
      uniform mat4 lightMatrix;
      flat out int kind;
      void main(){kind=int(material+.5);gl_Position=lightMatrix*vec4(position,1.);}
    `, `#version 300 es
      precision highp float;
      flat in int kind;
      void main(){if(kind==12)discard;}
    `);
    const surfaceProgram = program(`#version 300 es
      layout(location=0) in vec3 position;
      layout(location=1) in vec3 normal;
      layout(location=2) in vec2 uv;
      layout(location=3) in vec4 tint;
      layout(location=4) in float material;
      layout(location=5) in vec4 illumination;
      uniform mat4 viewMatrix;
      uniform mat4 lightMatrix;
      out vec3 worldPosition;
      out vec3 worldNormal;
      out vec2 textureUV;
      out vec4 paintTint;
      out vec4 shadowPosition;
      out vec4 bakedLight;
      flat out int kind;
      void main(){
        worldPosition=position;worldNormal=normal;textureUV=uv;paintTint=tint;kind=int(material+.5);
        bakedLight=illumination;
        shadowPosition=lightMatrix*vec4(position,1.);
        gl_Position=viewMatrix*vec4(position,1.);
      }
    `, `#version 300 es
      precision highp float;
      in vec3 worldPosition;
      in vec3 worldNormal;
      in vec2 textureUV;
      in vec4 paintTint;
      in vec4 shadowPosition;
      in vec4 bakedLight;
      flat in int kind;
      uniform sampler2D paintAtlas;
      uniform sampler2D shadowMap;
      uniform vec3 lightDirection;
      uniform vec3 eye;
      uniform vec4 lightingControls;
      out vec4 outputColor;
      float sunlight(vec3 normal){
        vec3 projected=shadowPosition.xyz/shadowPosition.w*.5+.5;
        if(any(lessThan(projected,vec3(0.)))||any(greaterThan(projected,vec3(1.))))return 0.;
        float bias=max(.00035,.0015*(1.-max(0.,dot(normal,lightDirection))));
        float result=0.;
        for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){
          float depth=texture(shadowMap,projected.xy+vec2(x,y)*1.35/1024.).r;
          result+=projected.z-bias<=depth?1.:0.;
        }
        return result/9.;
      }
      float windowAperture(vec3 point,vec3 ray) {
        if(ray.x>=-.001)return 0.;
        float travel=(-4.24-point.x)/ray.x;
        if(travel<=0.)return 0.;
        vec3 hit=point+ray*travel;
        return smoothstep(1.30,1.35,hit.y)*(1.-smoothstep(3.75,3.80,hit.y))*
          smoothstep(-4.80,-4.75,hit.z)*(1.-smoothstep(-1.25,-1.20,hit.z));
      }
      void main(){
        vec2 tile=vec2(kind%4,kind/4);
        vec2 uv=(tile+vec2(.04)+fract(textureUV)*.92)/4.;
        vec3 base=pow(textureGrad(paintAtlas,uv,dFdx(textureUV)*.23,dFdy(textureUV)*.23).rgb*paintTint.rgb,vec3(2.2));
        vec3 normal=normalize(worldNormal);
        if(!gl_FrontFacing)normal=-normal;
        vec3 viewDirection=normalize(eye-worldPosition);
        float diffuse=max(0.,dot(normal,lightDirection));
        float sun=sunlight(normal)*windowAperture(worldPosition,lightDirection)*lightingControls.x;
        float ao=mix(1.,bakedLight.r,lightingControls.y);
        vec3 hemisphere=mix(vec3(.23,.27,.32),vec3(.52,.59,.65),normal.y*.5+.5);
        vec3 indirect=hemisphere*mix(.52,1.,ao)+vec3(.53,.65,.78)*bakedLight.g*.44;
        indirect+=vec3(.93,.58,.29)*bakedLight.a*.76*lightingControls.z;
        float lamp=0.;
        for(int i=0;i<2;i++){
          vec3 lampVector=vec3(i==0?-1.8:1.8,i==0?2.96:3.09,-3.36)-worldPosition;
          lamp+=max(0.,dot(normal,normalize(lampVector)))*.40/(1.+dot(lampVector,lampVector)*.35);
        }
        vec3 lit=base*(indirect+vec3(1.,.76,.46)*diffuse*sun*1.85+vec3(1.,.66,.32)*lamp*ao);
        float shine=pow(max(0.,dot(normal,normalize(lightDirection+viewDirection))),20.);
        if(kind==4)lit+=vec3(.18,.13,.06)*shine*sun;
        if(kind==6||kind==8)lit+=vec3(.035)*shine*sun;
        if(kind==12)lit=base*1.16;
        if(kind==5){
          float fresnel=pow(1.-abs(dot(normal,viewDirection)),3.);
          vec3 reflected=reflect(-viewDirection,normal);
          float reflection=windowAperture(worldPosition,reflected)*lightingControls.w;
          float travel=(-4.24-worldPosition.x)/min(-.001,reflected.x);
          vec3 hit=worldPosition+reflected*max(0.,travel);
          float frame=(1.-smoothstep(.03,.085,abs(hit.y-2.55)))+
            (1.-smoothstep(.03,.085,abs(hit.z+3.)));
          reflection*=1.-min(.88,frame*.88);
          reflection=clamp(reflection+sun*.22*lightingControls.w,0.,1.);
          lit=mix(vec3(.30,.41,.42),vec3(.91,.87,.68),reflection*.72+fresnel*.12);
        }
        float distanceFog=smoothstep(9.,18.,length(eye-worldPosition))*.08;
        vec3 rgb=pow(clamp(lit,0.,1.),vec3(1./2.2));
        outputColor=vec4(mix(rgb,vec3(.73,.76,.78),distanceFog),paintTint.a);
      }
    `);
    const opaque = mesh({ ...scene.opaque, lighting });
    const transparent = scene.transparent.map(mesh);
    const paint = gl.createTexture();
    resources.push(() => gl.deleteTexture(paint));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, paint);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,atlas);
    gl.generateMipmap(gl.TEXTURE_2D);
    const shadow = gl.createTexture(), framebuffer = gl.createFramebuffer();
    resources.push(() => gl.deleteTexture(shadow), () => gl.deleteFramebuffer(framebuffer));
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, shadow);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT24,1024,1024,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,shadow,0);
    gl.drawBuffers([gl.NONE]);gl.readBuffer(gl.NONE);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Bakery daylight shadow map is unavailable.');
    gl.viewport(0,0,1024,1024);
    gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);
    gl.clearDepth(1);gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(depthProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(depthProgram,'lightMatrix'),false,light.matrix);
    gl.bindVertexArray(opaque.vao);gl.drawArrays(gl.TRIANGLES,0,opaque.count);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    const uniforms=Object.fromEntries(['viewMatrix','lightMatrix','paintAtlas','shadowMap','lightDirection','eye','lightingControls'].map(name=>[name,gl.getUniformLocation(surfaceProgram,name)]));
    if(gl.getError()!==gl.NO_ERROR)throw new Error('Bakery scene resources could not be uploaded.');
    let width=0,height=0;
    return {
      dispose,
      resize(w,h) {
        if(![w,h].every(Number.isFinite)||w<=0||h<=0)throw new RangeError('Positive bakery viewport required.');
        width=w;height=h;
        const ratio=Math.min(devicePixelRatio||1,1.75,Math.sqrt(2_000_000/(w*h)),4096/w,4096/h);
        canvas.width=Math.max(1,Math.ceil(w*ratio));canvas.height=Math.max(1,Math.ceil(h*ratio));
      },
      render(x=0,y=0,controls=[1,1,1,1]) {
        const view=bakeryView(width,height,x,y);
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);
        gl.viewport(0,0,canvas.width,canvas.height);
        gl.clearColor(.91,.84,.71,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);gl.depthMask(true);gl.disable(gl.BLEND);gl.disable(gl.DITHER);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);
        gl.useProgram(surfaceProgram);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,paint);
        gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,shadow);
        gl.uniform1i(uniforms.paintAtlas,0);gl.uniform1i(uniforms.shadowMap,1);
        gl.uniformMatrix4fv(uniforms.viewMatrix,false,view.matrix);
        gl.uniformMatrix4fv(uniforms.lightMatrix,false,light.matrix);
        gl.uniform3fv(uniforms.lightDirection,light.direction);gl.uniform3fv(uniforms.eye,view.eye);
        gl.uniform4fv(uniforms.lightingControls,controls);
        gl.bindVertexArray(opaque.vao);gl.drawArrays(gl.TRIANGLES,0,opaque.count);
        gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
        const distance=mesh=>mesh.center.reduce((sum,value,index)=>sum+(value-view.eye[index])**2,0);
        for(const item of [...transparent].sort((a,b)=>distance(b)-distance(a))){
          gl.bindVertexArray(item.vao);gl.drawArrays(gl.TRIANGLES,0,item.count);
        }
        gl.depthMask(true);gl.disable(gl.BLEND);
        return view;
      },
    };
  } catch(error) {
    dispose();
    throw error;
  }
}

export async function initBakeryInterior({ createBakeryScene }) {
  const entrance=document.getElementById('bakery-entrance'),room=document.querySelector('.entrance-room');
  if(!entrance||!room)return;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),forced=matchMedia('(forced-colors: active)'),printing=matchMedia('print');
  if(reduced.matches||forced.matches||printing.matches||location.hash||innerHeight<=450)return;
  if(getComputedStyle(room).getPropertyValue('--bakery-scene-ready').trim()!=='1')return;
  const atlas=new Image();
  atlas.src=new URL(`assets/bakery-paint-atlas.png${new URL(import.meta.url).search}`,import.meta.url).href;
  const [lightBuffer]=await Promise.all([
    fetch(new URL(`assets/bakery-light-bake.bin${new URL(import.meta.url).search}`,import.meta.url)).then(response=>{
      if(!response.ok)throw new Error('Baked bakery illumination is unavailable.');
      return response.arrayBuffer();
    }),atlas.decode()
  ]);
  if(entrance.hidden||location.hash||['finished','skipped'].includes(entrance.dataset.state))return;
  const canvas=document.createElement('canvas');
  canvas.className='bakery-interior';canvas.setAttribute('aria-hidden','true');canvas.hidden=true;
  room.append(canvas);
  const scene=createBakeryScene();
  const lighting=decodeBakeryLighting(scene,lightBuffer);
  let renderer,frame,last=0,look=[0,0],target=[0,0],width=0,height=0,density=0,lost=false,failed=false;
  const active=()=>!document.hidden&&!entrance.hidden&&entrance.dataset.state==='waiting'&&!reduced.matches&&!forced.matches&&!printing.matches;
  const stop=()=>{if(frame!==undefined)cancelAnimationFrame(frame);frame=undefined;last=0;};
  const fallback=error=>{
    stop();failed=true;room.classList.remove('is-3d-ready');canvas.hidden=true;
    renderer?.dispose();renderer=null;room.dataset.sceneState='fallback';
    console.warn('The optional painted bakery view is unavailable; keeping its static illustration.',error);
  };
  const size=()=>{
    const bounds=room.getBoundingClientRect();
    if(!bounds.width||!bounds.height)return false;
    if(width!==bounds.width||height!==bounds.height||density!==devicePixelRatio){
      width=bounds.width;height=bounds.height;density=devicePixelRatio;renderer.resize(width,height);
    }
    return true;
  };
  const draw=()=>{
    if(!renderer||!size())return;
    renderer.render(...look);canvas.hidden=false;room.classList.add('is-3d-ready');
    room.dataset.lookX=look[0].toFixed(4);room.dataset.lookY=look[1].toFixed(4);
  };
  const tick=time=>{
    frame=undefined;
    if(!active()||lost||failed){stop();return;}
    const weight=1-Math.exp(-Math.min(last?time-last:16,50)/70);
    last=time;
    look=look.map((value,index)=>value+(target[index]-value)*weight);
    try{draw();}catch(error){fallback(error);return;}
    if(Math.hypot(look[0]-target[0],look[1]-target[1])>.001){room.dataset.sceneState='moving';frame=requestAnimationFrame(tick);}
    else{look=[...target];draw();room.dataset.sceneState='ready';last=0;}
  };
  const update=()=>{
    if(entrance.hidden){
      stop();renderer?.dispose();renderer=null;canvas.hidden=true;canvas.width=1;canvas.height=1;
      canvas.remove();observer.disconnect();resize.disconnect();
      room.classList.remove('is-3d-ready');room.dataset.sceneState='finished';return;
    }
    if(!active()){stop();return;}
    if(lost||failed||!renderer)return;
    target=[Number(entrance.style.getPropertyValue('--look-x'))||0,Number(entrance.style.getPropertyValue('--look-y'))||0];
    if(frame===undefined){room.dataset.sceneState='moving';frame=requestAnimationFrame(tick);}
  };
  const initialize=()=>{
    renderer=createBakeryRenderer(canvas,scene,atlas,lighting);
    if(!renderer){room.dataset.sceneState='unsupported';console.info('WebGL2 is unavailable; retaining the painted bakery illustration.');return;}
    width=0;height=0;density=0;draw();room.dataset.sceneState='ready';update();
  };
  canvas.addEventListener('webglcontextlost',event=>{
    event.preventDefault();lost=true;stop();renderer=null;canvas.hidden=true;
    room.classList.remove('is-3d-ready');room.dataset.sceneState='context-lost';
  });
  canvas.addEventListener('webglcontextrestored',()=>{
    lost=false;
    try{initialize();}catch(error){fallback(error);}
  });
  const observer=new MutationObserver(update);
  observer.observe(entrance,{attributes:true,attributeFilter:['style','data-state','hidden']});
  const resize=new ResizeObserver(()=>{if(renderer&&active()){try{draw();update();}catch(error){fallback(error);}}});
  resize.observe(room);
  document.addEventListener('visibilitychange',()=>{stop();if(!document.hidden)update();});
  window.addEventListener('pagehide',stop);
  for(const media of [reduced,forced,printing])media.addEventListener('change',()=>{stop();if(media.matches){canvas.hidden=true;room.classList.remove('is-3d-ready');}else update();});
  try{initialize();}catch(error){fallback(error);}
  return ()=>{stop();observer.disconnect();resize.disconnect();renderer?.dispose();canvas.remove();room.classList.remove('is-3d-ready');};
}
