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
  vec2 flow = vec2(cloud(p * 1.7 + vec2(t, -t * 0.7)),
                   cloud(p * 1.8 + vec2(-t * 0.5, t + 8.0)));
  float billow = cloud(p * (2.0 + detail) + flow * 2.6 + vec2(t * 0.4, -t));
  float wave = p.y - 0.36 * sin(p.x * 2.7 + t)
    + (billow - 0.5) * (0.6 + detail * 0.7)
    + 0.10 * sin(t * 3.0 + p.x * 4.0) * energy;
  vec3 color = mix(mist, ink, smoothstep(-0.5, 0.55, wave));
  float ribbon = exp(-pow((wave + 0.07) * (4.2 + detail), 2.0));
  color = mix(color, vec3(0.98, 0.985, 1.0), ribbon * 0.93);
  float veil = cloud(p * 3.3 + flow + vec2(-t * 0.6, t));
  color = mix(color, mist, smoothstep(0.43, 0.85, veil) * 0.35);
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
