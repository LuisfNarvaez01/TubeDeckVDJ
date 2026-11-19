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

vec3 hueShift(vec3 col, float angle) {
  const vec3 k = vec3(0.57735, 0.57735, 0.57735);
  float cosAngle = cos(angle);
  return vec3(
    col * cosAngle +
    cross(k, col) * sin(angle) +
    k * dot(k, col) * (1.0 - cosAngle)
  );
}

vec4 applyAudioShader(vec2 uv, vec4 baseColor) {
  if (u_fxAudioShader <= 0.01) return baseColor;
  vec2 p = uv * 2.0 - 1.0;
  float dist = length(p);
  float wave = sin(dist * 14.0 - u_time * 4.5 + u_audioBands.x * 6.0) * 0.5 + 0.5;
  float rings = smoothstep(0.35, 0.95, wave) * (0.25 + u_audioBands.x * 0.75);
  vec3 reactive = vec3(
    0.05 + rings * (0.3 + u_audioBands.y),
    0.25 + rings * 0.75,
    0.45 + u_audioBands.z * 0.55
  );
  return mix(baseColor, vec4(max(baseColor.rgb, reactive), 1.0), clamp(u_fxAudioShader, 0.0, 1.0));
}

vec4 applyPostFx(vec4 color, vec2 uv) {
  vec3 rgb = color.rgb;
  if (u_fxHue > 0.01) {
    rgb = clamp(hueShift(rgb, u_fxHue * 6.2831853), 0.0, 1.0);
  }
  if (u_fxBw > 0.01) {
    float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
    float hi = smoothstep(0.18, 0.86, lum);
    rgb = mix(rgb, vec3(hi), clamp(u_fxBw, 0.0, 1.0));
  }
  vec4 outCol = applyAudioShader(uv, vec4(rgb, color.a));
  if (u_fxStrobe > 0.01) {
    outCol.rgb = mix(outCol.rgb, vec3(1.0), clamp(u_fxStrobe, 0.0, 1.0));
  }
  return outCol;
}
`;

