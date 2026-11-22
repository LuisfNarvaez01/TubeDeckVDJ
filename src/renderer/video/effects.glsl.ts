export const FX_UNIFORMS_GLSL = /* glsl */ `
uniform float u_time;
uniform vec3 u_audioBands;
uniform float u_fxBlur;
uniform float u_fxStrobe;
uniform int u_fxMirrorMode;
uniform float u_fxHue;
uniform float u_fxBw;
uniform float u_fxPixelate;
uniform float u_fxAudioShader;
`;

export const FX_HELPERS_GLSL = /* glsl */ `
vec2 applyMirrorUv(vec2 uv, int mode) {
  if (mode == 1) {
    return vec2(uv.x > 0.5 ? 1.0 - uv.x : uv.x, uv.y);
  }
  if (mode == 2) {
    return vec2(uv.x, uv.y > 0.5 ? 1.0 - uv.y : uv.y);
  }
  if (mode == 3) {
    return vec2(
      uv.x > 0.5 ? 1.0 - uv.x : uv.x,
      uv.y > 0.5 ? 1.0 - uv.y : uv.y
    );
  }
  return uv;
}

vec2 applyPixelateUv(vec2 uv, float amount) {
  if (amount <= 0.01) return uv;
  float blocks = mix(320.0, 24.0, clamp(amount, 0.0, 1.0));
  return floor(uv * blocks) / blocks;
}

float fxHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

/** Duotone in the Proyecta colors (deep magenta shadows, cyan highlights), drifting slowly. */
vec3 duotone(vec3 rgb, float amount) {
  float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  float drift = 0.5 + 0.5 * sin(u_time * 0.25);
  vec3 shadow = mix(vec3(0.22, 0.02, 0.18), vec3(0.02, 0.06, 0.22), drift);
  vec3 light = mix(vec3(0.13, 0.88, 0.94), vec3(1.0, 0.31, 0.66), drift);
  vec3 tone = mix(shadow, light, smoothstep(0.05, 0.95, lum));
  tone *= 1.0 + u_audioBands.x * 0.25;
  return mix(rgb, tone, clamp(amount, 0.0, 1.0));
}

/** Film black and white: S-curve contrast, moving grain, soft vignette. */
vec3 filmMono(vec3 rgb, vec2 uv, float amount) {
  float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  lum = smoothstep(0.04, 0.96, lum);
  lum = lum * lum * (3.0 - 2.0 * lum);
  float grain = (fxHash(uv * 900.0 + fract(u_time * 23.0)) - 0.5) * 0.09;
  float vig = 1.0 - smoothstep(0.35, 1.15, length(uv - 0.5) * 1.6);
  vec3 mono = vec3(clamp(lum + grain, 0.0, 1.0) * mix(0.55, 1.0, vig));
  return mix(rgb, mono, clamp(amount, 0.0, 1.0));
}

/** Edge glow that breathes with the bass, color drifting between the two deck colors. */
vec4 applyAudioShader(vec2 uv, vec4 baseColor) {
  if (u_fxAudioShader <= 0.01) return baseColor;
  float amt = clamp(u_fxAudioShader, 0.0, 1.0);
  float bass = smoothstep(0.25, 0.85, u_audioBands.x);
  float d = length((uv - 0.5) * vec2(1.25, 1.0));
  vec3 glowCol = mix(vec3(0.13, 0.88, 0.94), vec3(1.0, 0.31, 0.66), 0.5 + 0.5 * sin(u_time * 0.6));
  float edge = smoothstep(0.32, 0.78, d) * (0.15 + bass * 0.85);
  vec3 rgb = baseColor.rgb * (1.0 + bass * 0.18 * amt);
  rgb = mix(rgb, rgb * 0.55 + glowCol * 0.9, edge * amt);
  return vec4(clamp(rgb, 0.0, 1.0), baseColor.a);
}

vec4 applyPostFx(vec4 color, vec2 uv) {
  vec3 rgb = color.rgb;
  if (u_fxHue > 0.01) {
    rgb = duotone(rgb, u_fxHue);
  }
  if (u_fxBw > 0.01) {
    rgb = filmMono(rgb, uv, u_fxBw);
  }
  vec4 outCol = applyAudioShader(uv, vec4(rgb, color.a));
  if (u_fxStrobe > 0.01) {
    // Exposure flash on the beat (keeps the picture) instead of a flat white frame.
    outCol.rgb = mix(outCol.rgb, min(vec3(1.0), outCol.rgb * 1.9 + 0.22), clamp(u_fxStrobe, 0.0, 1.0));
  }
  return outCol;
}
`;
