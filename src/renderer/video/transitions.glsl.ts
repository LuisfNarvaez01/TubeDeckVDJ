import { FX_HELPERS_GLSL, FX_UNIFORMS_GLSL } from './effects.glsl';

export type VideoTransitionId =
  | 'dissolve'
  | 'wipe-h'
  | 'wipe-v'
  | 'wipe-diag'
  | 'zoom-push'
  | 'circle-iris'
  | 'luma-fade'
  | 'curtain-split'
  | 'slide';

export const VERTEX_SHADER_SRC = /* glsl */ `#version 300 es
precision highp float;
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;

void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

function buildTransitionShader(transitionBody: string): string {
  return /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_texA;
uniform sampler2D u_texB;
uniform sampler2D u_texOverlay;
uniform float u_hasA;
uniform float u_hasB;
uniform float u_hasOverlay;
uniform float u_mix;
uniform float u_aspectA;
uniform float u_aspectB;
uniform float u_canvasAspect;
uniform vec4 u_videoRect;
${FX_UNIFORMS_GLSL}
${FX_HELPERS_GLSL}

vec4 sampleFitted(sampler2D tex, float hasTex, vec2 uv, float texAspect) {
  if (hasTex < 0.5) return vec4(0.0, 0.0, 0.0, 1.0);
  vec2 adj = uv;
  if (texAspect > u_canvasAspect) {
    float scaleY = texAspect / max(u_canvasAspect, 0.001);
    adj.y = (uv.y - 0.5) * scaleY + 0.5;
  } else {
    float scaleX = u_canvasAspect / max(texAspect, 0.001);
    adj.x = (uv.x - 0.5) * scaleX + 0.5;
  }
  if (adj.x < 0.0 || adj.x > 1.0 || adj.y < 0.0 || adj.y > 1.0) {
    return vec4(0.0, 0.0, 0.0, 1.0);
  }
  vec2 warped = applyPixelateUv(applyMirrorUv(adj, u_fxMirrorMode), u_fxPixelate);
  vec4 base = texture(tex, warped);
  if (u_fxBlur > 0.02) {
    float off = u_fxBlur * 0.008;
    vec4 acc = base * 0.4;
    acc += texture(tex, clamp(warped + vec2(off, 0.0), 0.0, 1.0)) * 0.15;
    acc += texture(tex, clamp(warped - vec2(off, 0.0), 0.0, 1.0)) * 0.15;
    acc += texture(tex, clamp(warped + vec2(0.0, off), 0.0, 1.0)) * 0.15;
    acc += texture(tex, clamp(warped - vec2(0.0, off), 0.0, 1.0)) * 0.15;
    base = acc;
  }
  return base;
}

void main() {
  float m = clamp(u_mix, 0.0, 1.0);
  vec2 rectMin = u_videoRect.xy;
  vec2 rectSize = max(u_videoRect.zw, vec2(0.001));
  vec2 uv = (v_uv - rectMin) / rectSize;
  bool insideVideo = uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
  vec4 finalCol = vec4(0.02, 0.025, 0.04, 1.0);
  if (insideVideo) {
    vec4 colA = sampleFitted(u_texA, u_hasA, uv, u_aspectA);
    vec4 colB = sampleFitted(u_texB, u_hasB, uv, u_aspectB);
    vec4 mixed = vec4(0.0, 0.0, 0.0, 1.0);
${transitionBody}
    finalCol = applyPostFx(mixed, uv);
  }
  if (u_hasOverlay > 0.5) {
    vec4 ov = texture(u_texOverlay, v_uv);
    finalCol.rgb = mix(finalCol.rgb, ov.rgb, ov.a);
  }
  fragColor = vec4(finalCol.rgb, 1.0);
}
`;
}

export const TRANSITION_SHADERS: Record<VideoTransitionId, string> = {
  dissolve: buildTransitionShader(`
  mixed = mix(colA, colB, m);
  `),
  'wipe-h': buildTransitionShader(`
  float edge = smoothstep(m - 0.03, m + 0.03, uv.x);
  mixed = mix(colB, colA, edge);
  `),
  'wipe-v': buildTransitionShader(`
  float edge = smoothstep(m - 0.03, m + 0.03, uv.y);
  mixed = mix(colB, colA, edge);
  `),
  'wipe-diag': buildTransitionShader(`
  float diag = (uv.x + uv.y) * 0.5;
  float edge = smoothstep(m - 0.04, m + 0.04, diag);
  mixed = mix(colB, colA, edge);
  `),
  'zoom-push': buildTransitionShader(`
  vec2 uvA = (uv - 0.5) * (1.0 - m * 0.35) + 0.5;
  vec2 uvB = (uv - 0.5) * (1.35 - m * 0.35) + 0.5;
  vec4 zA = sampleFitted(u_texA, u_hasA, uvA, u_aspectA);
  vec4 zB = sampleFitted(u_texB, u_hasB, uvB, u_aspectB);
  mixed = mix(zA, zB, m);
  `),
  'circle-iris': buildTransitionShader(`
  float dist = distance(uv, vec2(0.5)) * 1.4142;
  float mask = smoothstep(m - 0.04, m + 0.04, dist);
  mixed = mix(colB, colA, mask);
  `),
  'luma-fade': buildTransitionShader(`
  float lum = dot(colB.rgb, vec3(0.299, 0.587, 0.114));
  float mask = smoothstep(lum - 0.15, lum + 0.15, m * 1.3 - 0.15);
  mixed = mix(colA, colB, mask);
  `),
  'curtain-split': buildTransitionShader(`
  float distX = abs(uv.x - 0.5) * 2.0;
  float mask = smoothstep(m - 0.03, m + 0.03, distX);
  mixed = mix(colB, colA, mask);
  `),
  slide: buildTransitionShader(`
  vec2 sA = vec2(uv.x + m, uv.y);
  vec2 sB = vec2(uv.x - (1.0 - m), uv.y);
  mixed = uv.x < (1.0 - m)
    ? sampleFitted(u_texA, u_hasA, sA, u_aspectA)
    : sampleFitted(u_texB, u_hasB, sB, u_aspectB);
  `)
};

