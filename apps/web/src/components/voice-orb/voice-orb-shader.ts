const VERTEX = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = position;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAGMENT = `
precision highp float;
varying vec2 uv;
uniform float time;
uniform float energy;
uniform float detail;
uniform vec2 pointer;
uniform vec3 ink;
uniform vec3 mist;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
}
float cloud(vec2 p) {
  return noise(p) * 0.58 + noise(p * 2.03) * 0.28 + noise(p * 4.01) * 0.14;
}
void main() {
  float radius = length(uv);
  float alpha = 1.0 - smoothstep(0.975, 0.995, radius);
  float depth = sqrt(max(0.0, 1.0 - dot(uv, uv)));
  vec2 p = uv + pointer * 0.13 * depth;
  float t = time * 0.24;

  // Rotate a cloud bank through the sphere, with independent tilt and travel.
  float angle = t * 0.22 + 0.55 * sin(t * 0.37) + 0.35 * sin(t * 0.83);
  vec3 direction = normalize(vec3(sin(angle), cos(angle), 0.65 * sin(t * 0.29)));
  float travel = 0.38 * sin(t * 0.61) + 0.2 * sin(t * 0.97 + 2.0)
    + energy * 0.22 * sin(t * 0.43 + 1.3);
  vec2 drift = vec2(t * 0.18, -t * 0.27);
  vec2 flow = vec2(cloud(p * 1.4 + drift),
                   cloud(p * 1.6 - drift * 0.7 + 8.0));
  float billow = cloud(p * (2.2 + detail) + flow * 1.8 + drift);
  float bank = dot(vec3(p, depth), direction) - travel
    + (billow - 0.5) * (0.24 + detail * 0.3);

  // Broad white banks dissolve into blue; fine wisps live at their edges.
  vec3 color = mix(mist, ink, smoothstep(-0.25, 0.75, bank));
  float softness = 2.4 + detail * 0.6;
  float cloudDistance = (bank + 0.05) * softness;
  float whiteCloud = exp(-cloudDistance * cloudDistance);
  float wisps = cloud(p * 5.0 + flow * 2.0 + vec2(-t * 0.31, t * 0.23));
  color = mix(color, vec3(0.96, 0.975, 1.0), whiteCloud * (0.78 + wisps * 0.2));
  float veil = cloud(p * 1.8 - flow + vec2(t * 0.13, t * 0.19));
  color = mix(color, mist, smoothstep(0.4, 0.85, veil) * (0.1 + energy * 0.08));
  color += pow(1.0 - depth, 3.0) * 0.075;
  gl_FragColor = vec4(color, alpha);
}
`;

export interface OrbFrame {
  time: number;
  energy: number;
  detail: number;
  pointer: readonly [number, number];
  ink: readonly [number, number, number];
  mist: readonly [number, number, number];
}

export function createOrbRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false });
  if (!gl) return null;

  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  const shaders: WebGLShader[] = [];
  function dispose() {
    for (const shader of shaders) gl?.deleteShader(shader);
    gl?.deleteBuffer(buffer);
    gl?.deleteProgram(program);
  }
  if (!program || !buffer) {
    dispose();
    return null;
  }
  for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
    const shader = gl.createShader(type);
    if (!shader) {
      dispose();
      return null;
    }
    shaders.push(shader);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      dispose();
      return null;
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    dispose();
    return null;
  }
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const uniforms = {
    time: gl.getUniformLocation(program, "time"),
    energy: gl.getUniformLocation(program, "energy"),
    detail: gl.getUniformLocation(program, "detail"),
    pointer: gl.getUniformLocation(program, "pointer"),
    ink: gl.getUniformLocation(program, "ink"),
    mist: gl.getUniformLocation(program, "mist"),
  };
  return {
    dispose,
    draw(frame: OrbFrame) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(uniforms.time, frame.time);
      gl.uniform1f(uniforms.energy, frame.energy);
      gl.uniform1f(uniforms.detail, frame.detail);
      gl.uniform2f(uniforms.pointer, ...frame.pointer);
      gl.uniform3f(uniforms.ink, ...frame.ink);
      gl.uniform3f(uniforms.mist, ...frame.mist);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
  };
}
