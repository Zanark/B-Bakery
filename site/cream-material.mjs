export function createCreamShaders({ MAX_PRIMITIVES, TRAIL_PROFILE, CREAM_PROFILE }) {
const vertex = `#version 300 es
in vec2 position;
void main(){gl_Position=vec4(position,0.,1.);}
`;
const fragment = `#version 300 es
precision highp float;
uniform vec2 resolution;
uniform float pixelRatio;
uniform vec2 viewSize;
uniform int scoopCount;
uniform vec4 scoops[${MAX_PRIMITIVES}];
uniform vec4 trail[${TRAIL_PROFILE.links}];
uniform int trailCount;
uniform float headRadius;
uniform float cursorTint;
out vec4 color;

float merge(float a,float b,float k){
  float h=max(k-abs(a-b),0.)/k;
  return min(a,b)-h*h*k*.25;
}
vec2 tailSurface(vec2 p){
  vec2 nearest=vec2(100000.,0.);
  for(int i=0;i<${TRAIL_PROFILE.links};i++){
    if(i>=trailCount)break;
    vec2 a=trail[i].xy,b=trail[i].zw,axis=b-a;
    float lengthSquared=dot(axis,axis);
    if(lengthSquared<.25)continue;
    float t=clamp(dot(p-a,axis)/lengthSquared,0.,1.);
    float progress=(float(i)+t)/${TRAIL_PROFILE.links.toFixed(1)};
    float radius=headRadius*mix(${TRAIL_PROFILE.startRadius.toFixed(3)},${TRAIL_PROFILE.endRadius.toFixed(3)},progress);
    float distance=length(p-mix(a,b,t))-radius;
    if(distance<nearest.x)nearest=vec2(distance,radius);
  }
  return nearest;
}
float surface(vec2 p){
  float d=100000.;
  float blend=min(viewSize.x,viewSize.y)*.040;
  for(int i=0;i<${MAX_PRIMITIVES};i++){
    if(i>=scoopCount)break;
    vec4 s=scoops[i];
    d=merge(d,length(p-s.xy)-s.z,blend);
  }
  return merge(d,tailSurface(p).x,min(blend*.4,headRadius*.4));
}
float creamHeight(vec2 p,float distance,float scale){
  float totalWeight=0.;
  float totalHeight=0.;
  for(int i=0;i<${MAX_PRIMITIVES};i++){
    if(i>=scoopCount)break;
    vec4 s=scoops[i];
    vec2 q=(p-s.xy)/s.z;
    float q2=dot(q,q);
    if(q2>9.)continue;
    float weight=exp(-q2*${CREAM_PROFILE.weightFalloff.toFixed(3)});
    float dome=s.z*${CREAM_PROFILE.domeHeight.toFixed(3)}*exp(-q2*${CREAM_PROFILE.domeFalloff.toFixed(3)});
    float crown=0.;
    if(s.w>0.){
      float angle=float(i)*2.399963+.35;
      vec2 tip=s.xy+vec2(cos(angle)*.12,sin(angle)*.10)*s.z;
      vec2 peak=(p-tip)/(s.z*${CREAM_PROFILE.peakWidth.toFixed(3)});
      crown=exp(-${CREAM_PROFILE.peakFalloff.toFixed(3)}*(sqrt(dot(peak,peak)+${(CREAM_PROFILE.peakRoundness ** 2).toFixed(6)})-${CREAM_PROFILE.peakRoundness.toFixed(3)}));
    }
    totalHeight+=weight*(dome+s.z*${CREAM_PROFILE.peakHeight.toFixed(3)}*s.w*crown);
    totalWeight+=weight;
  }
  vec2 tail=tailSurface(p);
  if(tail.y>0.){
    float q=max(0.,tail.x+tail.y)/tail.y;
    float weight=exp(-q*q*${CREAM_PROFILE.weightFalloff.toFixed(3)});
    totalHeight+=weight*tail.y*.5*exp(-q*q*${CREAM_PROFILE.domeFalloff.toFixed(3)});
    totalWeight+=weight;
  }
  float rim=1.-exp(-max(-distance,0.)/(scale*${CREAM_PROFILE.rimWidth.toFixed(3)}));
  return rim*totalHeight/max(totalWeight,.00001);
}
void main(){
  vec2 p=vec2(gl_FragCoord.x,resolution.y-gl_FragCoord.y)/pixelRatio;
  float scale=min(viewSize.x,viewSize.y);
  float d=surface(p);
  float aa=max(fwidth(d),.55);
  float coverage=1.-smoothstep(-aa,aa,d);
  float shadowDistance=surface(p-vec2(6.,11.));
  float shadow=(1.-smoothstep(-5.,scale*.034,shadowDistance))*(1.-coverage)*.10;
  float height=creamHeight(p,d,scale);
  vec3 normal=normalize(vec3(-dFdx(height)*pixelRatio,dFdy(height)*pixelRatio,1.));
  vec3 light=normalize(vec3(-.55,-.78,.72));
  float diffuse=max(0.,dot(normal,light));
  vec3 halfway=normalize(light+vec3(0.,0.,1.));
  float gloss=pow(max(0.,dot(normal,halfway)),48.);
  float broad=pow(max(0.,dot(normal,halfway)),8.);
  vec3 ivory=vec3(255.,250.,238.)/255.;
  if(cursorTint>.5){
    float follower=min(length(p-scoops[scoopCount-1].xy)-headRadius,tailSurface(p).x);
    float strawberry=1.-smoothstep(-aa,aa,follower);
    ivory=mix(ivory,vec3(255.,224.,234.)/255.,strawberry);
  }
  vec3 cream=ivory*(.86+.14*diffuse);
  cream+=vec3(1.,.995,.97)*(.18*gloss+.035*broad);
  float grain=fract(sin(dot(floor(p*pixelRatio),vec2(12.9898,78.233)))*43758.5453);
  cream+=(grain-.5)*.003;
  // Associated alpha lets the patterned ground show only outside cream and through its shadow.
  float alpha=1.-(1.-shadow)*(1.-coverage);
  color=vec4(clamp(cream,0.,1.)*coverage,alpha);
}
`;
  return { vertex, fragment };
}
