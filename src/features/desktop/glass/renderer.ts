import { readGlassMaterial } from '../../../shared/glass-material';

export type GlassMode = 'real' | 'natural' | 'soft';

const vertex = `#version 300 es
in vec2 a_position;
void main() { gl_Position=vec4(a_position,0.,1.); }
`;
const fragment = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2 u_view;
uniform vec2 u_buffer;
uniform vec2 u_origin;
uniform vec2 u_extent;
uniform vec4 u_rect;
uniform float u_radius;
uniform vec2 u_image;
uniform sampler2D u_texture;
uniform float u_mode;
uniform vec4 u_tintStart;
uniform vec4 u_tintEnd;
uniform vec4 u_optics;
uniform vec3 u_blur;
float roundedBox(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return min(max(q.x,q.y),0.)+length(max(q,0.))-r;}
vec3 backdrop(vec2 p,float lod){
 vec2 uv=p/u_view;
 float cover=max(u_view.x/u_image.x,u_view.y/u_image.y);
 vec2 coord=(p-u_view*.5)/(u_image*cover)+.5;
 vec3 color=textureLod(u_texture,clamp(coord,0.,1.),lod).rgb;
 float shade=uv.y<.55?mix(.2,.08,uv.y/.55):mix(.08,.30,(uv.y-.55)/.45);
 return mix(color,vec3(.035,.082,.118),shade);
}
void main(){
 vec2 screen=vec2(gl_FragCoord.x,u_buffer.y-gl_FragCoord.y)*u_extent/u_buffer+u_origin;
 vec2 halfSize=u_rect.zw*.5;
 vec2 local=screen-u_rect.xy-halfSize;
 float radius=min(u_radius,min(halfSize.x,halfSize.y));
 float sdf=roundedBox(local,halfSize,radius);
 float alpha=1.-smoothstep(-.7,.7,sdf);
 if(alpha<=0.)discard;
 float depth=max(0.,-sdf);
 // Keep displacement derivatives below one: the previous thick bevel folded
 // dense wallpaper lines into bands, resembling a raised plastic frame.
 vec2 q=abs(local)-halfSize+radius;
 vec2 normal=sign(local)*normalize(max(q,0.)+vec2(.0001));
 if(max(q.x,q.y)<0.) {
   float blend=smoothstep(-8.,8.,q.x-q.y);
   normal=normalize(sign(local)*vec2(blend,1.-blend)+vec2(.00001));
 }
 // Rolled glass edge: strong near the silhouette, smoothly vanishing inside.
 // The displacement slope stays below one, avoiding duplicated texture bands.
 float roll=exp(-depth/16.);
 float strength=u_mode<.5?7.:u_mode<1.5?5.:3.;
 vec2 refracted=screen-normal*strength*roll-local*.012;
 // Roughness is measured in CSS pixels, independent of wallpaper resolution.
 float cover=max(u_view.x/u_image.x,u_view.y/u_image.y);
 float blur=u_mode<.5?u_blur.x+roll:u_mode<1.5?u_blur.y:u_blur.z;
 float lod=max(0.,log2(max(1.,blur/max(cover,.001))));
 vec3 color=backdrop(refracted,lod);
 if(u_mode>.5){
   vec2 spread=vec2(blur*.5);
   color=color*.4+(backdrop(refracted+spread,lod)+backdrop(refracted-spread,lod)+backdrop(refracted+vec2(-spread.x,spread.y),lod)+backdrop(refracted+vec2(spread.x,-spread.y),lod))*.15;
 }
 // Premultiplied interpolation matches the shared CSS gradient stops.
 vec2 axis=vec2(sin(u_optics.x),-cos(u_optics.x));
 float gradient=clamp(.5+dot(local,axis)/(2.*dot(halfSize,abs(axis))),0.,1.);
 float opacity=mix(u_tintStart.a,u_tintEnd.a,gradient);
 vec3 tint=mix(u_tintStart.rgb*u_tintStart.a,u_tintEnd.rgb*u_tintEnd.a,gradient)/max(opacity,.0001);
 float luminance=dot(color,vec3(.2126,.7152,.0722));
 color=clamp(mix(vec3(luminance),color,u_optics.y),0.,1.);
 color=mix(color,tint,opacity);
 // Match the wheel's single 1px inset rim and top reflection, without a bevel band.
 float rim=1.-smoothstep(.45,1.05,depth);
 float upper=max(-normal.y,0.);
 float highlight=1.-(1.-u_optics.z*rim)*(1.-u_optics.w*rim*upper);
 color=mix(color,vec3(1.),highlight);
 outColor=vec4(color*alpha,alpha);
}
`;

/** Native-resolution cropped surface; clear glass uses one texture sample, rough glass five. */
export function createGlassRenderer(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'low-power',
  });
  if (!context) throw new Error('WebGL unavailable');
  const gl: WebGL2RenderingContext = context;
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(message || 'Shader failed');
    }
    return s;
  };
  const vs = shader(gl.VERTEX_SHADER, vertex),
    fs = shader(gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error('Glass link failed');
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.useProgram(program);
  const pos = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  const uniforms = Object.fromEntries(
    [
      'view',
      'buffer',
      'origin',
      'extent',
      'rect',
      'radius',
      'image',
      'texture',
      'mode',
      'tintStart',
      'tintEnd',
      'optics',
      'blur',
    ].map((name) => [name, gl.getUniformLocation(program, `u_${name}`)]),
  );
  const material = readGlassMaterial();
  gl.uniform4fv(uniforms.tintStart!, material.start);
  gl.uniform4fv(uniforms.tintEnd!, material.end);
  gl.uniform4fv(uniforms.optics!, material.optics);
  gl.uniform3fv(uniforms.blur!, material.blur);
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    gl.LINEAR_MIPMAP_LINEAR,
  );
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 255]),
  );
  gl.generateMipmap(gl.TEXTURE_2D);
  let imageWidth = 1,
    imageHeight = 1,
    hasImage = false;
  let revision = 0;
  let lastKey = '';
  function setImage(image: HTMLImageElement) {
    if (!image.complete || !image.naturalWidth) return false;
    // WebGL2 supports mipmaps on the native 4K NPOT image, with no resampling.
    const limit = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (image.naturalWidth > limit || image.naturalHeight > limit)
      throw new Error('Wallpaper exceeds GPU texture limit');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    revision++;
    imageWidth = image.naturalWidth;
    imageHeight = image.naturalHeight;
    hasImage = true;
    return true;
  }
  function render(rects: (DOMRect & { radius: number })[], mode: GlassMode) {
    // Keep CSS glass until a decoded wallpaper has been uploaded.
    if (!hasImage) return false;
    const visible = rects.filter(
      (r) =>
        r.bottom > 0 &&
        r.top < innerHeight &&
        r.right > 0 &&
        r.left < innerWidth,
    );
    const scale = devicePixelRatio || 1;
    const key = JSON.stringify([
      revision,
      mode,
      innerWidth,
      innerHeight,
      scale,
      ...visible.map((r) => [r.x, r.y, r.width, r.height, r.radius]),
    ]);
    if (key === lastKey) return false;
    lastKey = key;
    // Quantized bounds avoid reallocating for every subpixel of a drag.
    const left = visible.length
      ? Math.max(
          0,
          Math.floor(Math.min(...visible.map((r) => r.left)) / 64) * 64,
        )
      : 0;
    const top = visible.length
      ? Math.max(
          0,
          Math.floor(Math.min(...visible.map((r) => r.top)) / 64) * 64,
        )
      : 0;
    const right = visible.length
      ? Math.min(
          innerWidth,
          Math.ceil(Math.max(...visible.map((r) => r.right)) / 64) * 64,
        )
      : 1;
    const bottom = visible.length
      ? Math.min(
          innerHeight,
          Math.ceil(Math.max(...visible.map((r) => r.bottom)) / 64) * 64,
        )
      : 1;
    const extentX = Math.max(1, right - left),
      extentY = Math.max(1, bottom - top);
    const width = Math.max(1, Math.round(extentX * scale)),
      height = Math.max(1, Math.round(extentY * scale));
    canvas.style.left = `${left}px`;
    canvas.style.top = `${top}px`;
    canvas.style.width = `${extentX}px`;
    canvas.style.height = `${extentY}px`;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(uniforms.view!, innerWidth, innerHeight);
    gl.uniform2f(uniforms.buffer!, width, height);
    gl.uniform2f(uniforms.origin!, left, top);
    gl.uniform2f(uniforms.extent!, extentX, extentY);
    gl.uniform2f(uniforms.image!, imageWidth, imageHeight);
    gl.uniform1i(uniforms.texture!, 0);
    gl.uniform1f(
      uniforms.mode!,
      mode === 'real' ? 0 : mode === 'natural' ? 1 : 2,
    );
    gl.enable(gl.SCISSOR_TEST);
    for (const rect of visible) {
      if (
        rect.bottom < 0 ||
        rect.top > innerHeight ||
        rect.right < 0 ||
        rect.left > innerWidth
      )
        continue;
      const x = Math.max(0, Math.floor((rect.left - left) * scale)),
        y = Math.max(0, Math.floor((bottom - rect.bottom) * scale));
      gl.scissor(
        x,
        y,
        Math.min(width - x, Math.ceil(rect.width * scale) + 2),
        Math.min(height - y, Math.ceil(rect.height * scale) + 2),
      );
      gl.uniform4f(uniforms.rect!, rect.x, rect.y, rect.width, rect.height);
      gl.uniform1f(uniforms.radius!, rect.radius);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.disable(gl.SCISSOR_TEST);
    return true;
  }
  return {
    render,
    setImage,
    destroy() {
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  };
}
