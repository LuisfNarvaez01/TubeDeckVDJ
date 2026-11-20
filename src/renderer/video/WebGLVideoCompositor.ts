import {
  TRANSITION_SHADERS,
  VERTEX_SHADER_SRC,
  type VideoTransitionId
} from './transitions.glsl';

export type { VideoTransitionId };
export type VideoCrossfaderMode = 'linked' | 'independent' | 'auto-timed';

export interface CompositorFrameState {
  mix: number;
  transition: VideoTransitionId;
  videoA: HTMLVideoElement | null;
  videoB: HTMLVideoElement | null;
  overlayCanvas: HTMLCanvasElement | null;
  timeSec?: number;
  audioBands?: { low: number; mid: number; high: number };
  fxUniforms?: Record<string, number>;
}

const QUAD_VERTICES = new Float32Array([
  -1, -1, 0, 0,
   1, -1, 1, 0,
  -1,  1, 0, 1,
   1,  1, 1, 1
]);

interface VideoSlotCache {
  hasValidTex: boolean;
  lastAspect: number;
  lastVideoTime: number;
  lastVideoSrc: string;
}

function createEmptySlotCache(): VideoSlotCache {
  return {
    hasValidTex: false,
    lastAspect: 16 / 9,
    lastVideoTime: -1,
    lastVideoSrc: ''
  };
}

export class WebGLVideoCompositor {
  private readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private programs = new Map<VideoTransitionId, WebGLProgram>();
  private uniformCache = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;
  private texA: WebGLTexture | null = null;
  private texB: WebGLTexture | null = null;
  private texOverlay: WebGLTexture | null = null;
  private slotCaches: Record<'A' | 'B', VideoSlotCache> = {
    A: createEmptySlotCache(),
    B: createEmptySlotCache()
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  init(): boolean {
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true
    });

    if (!gl) {
      this.ctx2d = this.canvas.getContext('2d');
      return Boolean(this.ctx2d);
    }

    this.gl = gl;

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTICES, gl.STATIC_DRAW);

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

    this.vao = vao;
    this.vbo = vbo;

    this.texA = this.createTexture(gl);
    this.texB = this.createTexture(gl);
    this.texOverlay = this.createTexture(gl);

    return true;
  }

  private createTexture(gl: WebGL2RenderingContext): WebGLTexture | null {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  private compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Failed to create WebGL shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'unknown error';
      gl.deleteShader(shader);
      throw new Error(`Shader compilation failed: ${log}`);
    }
    return shader;
  }

  private getOrCreateProgram(gl: WebGL2RenderingContext, transition: VideoTransitionId): WebGLProgram {
    const existing = this.programs.get(transition);
    if (existing) return existing;

    const vs = this.compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, TRANSITION_SHADERS[transition]);

    const program = gl.createProgram();
    if (!program) throw new Error('Failed to create WebGL program');
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? 'unknown error';
      gl.deleteProgram(program);
      throw new Error(`Program link failed: ${log}`);
    }

    this.programs.set(transition, program);
    return program;
  }

  setResolution(width: number, height: number): void {
    this.canvas.width = Math.max(320, width);
    this.canvas.height = Math.max(180, height);
  }

  stepAutoTransition(progress01: number, fromSide: 'A' | 'B'): number {
    const t = Math.min(1, Math.max(0, progress01));
    const eased = t * t * (3 - 2 * t);
    return fromSide === 'A' ? eased : 1 - eased;
  }

  private getUniformLocationCached(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    name: string
  ): WebGLUniformLocation | null {
    let map = this.uniformCache.get(program);
    if (!map) {
      map = new Map();
      this.uniformCache.set(program, map);
    }
    if (map.has(name)) {
      return map.get(name) ?? null;
    }
    const loc = gl.getUniformLocation(program, name);
    map.set(name, loc);
    return loc;
  }

  private uploadVideoTexture(
    gl: WebGL2RenderingContext,
    slot: 'A' | 'B',
    unit: number,
    tex: WebGLTexture | null,
    video: HTMLVideoElement | null
  ): { active: number; aspect: number } {
    const cache = this.slotCaches[slot];
    gl.activeTexture(unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);

    if (!video || !video.src) {
      cache.hasValidTex = false;
      cache.lastVideoTime = -1;
      cache.lastVideoSrc = '';
      return { active: 0, aspect: 16 / 9 };
    }

    if (video.src !== cache.lastVideoSrc) {
      cache.hasValidTex = false;
      cache.lastVideoTime = -1;
      cache.lastVideoSrc = video.src;
    }

    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      const aspect = video.videoWidth / video.videoHeight;
      if (!cache.hasValidTex || video.currentTime !== cache.lastVideoTime) {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        cache.hasValidTex = true;
        cache.lastVideoTime = video.currentTime;
      }
      cache.lastAspect = aspect;
      return { active: 1, aspect };
    }

    // Hold last valid GPU frame during seeks/re-buffering so screen never flashes black
    if (cache.hasValidTex) {
      return { active: 1, aspect: cache.lastAspect };
    }

    return { active: 0, aspect: 16 / 9 };
  }

  renderFrame(state: CompositorFrameState): void {
    const mix = Math.min(1, Math.max(0, state.mix));
    if (!this.gl) {
      this.renderFallback2d({ ...state, mix });
      return;
    }

    const gl = this.gl;
    const program = this.getOrCreateProgram(gl, state.transition);
    const loc = (name: string) => this.getUniformLocationCached(gl, program, name);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindVertexArray(this.vao);

    const aInfo = this.uploadVideoTexture(gl, 'A', gl.TEXTURE0, this.texA, state.videoA);
    const bInfo = this.uploadVideoTexture(gl, 'B', gl.TEXTURE1, this.texB, state.videoB);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.texOverlay);
    let hasOverlay = 0;
    if (state.overlayCanvas) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, state.overlayCanvas);
      hasOverlay = 1;
    }

    gl.uniform1i(loc('u_texA'), 0);
    gl.uniform1i(loc('u_texB'), 1);
    gl.uniform1i(loc('u_texOverlay'), 2);
    gl.uniform1f(loc('u_hasA'), aInfo.active);
    gl.uniform1f(loc('u_hasB'), bInfo.active);
    gl.uniform1f(loc('u_hasOverlay'), hasOverlay);
    gl.uniform1f(loc('u_mix'), mix);
    gl.uniform1f(loc('u_aspectA'), aInfo.aspect);
    gl.uniform1f(loc('u_aspectB'), bInfo.aspect);
    gl.uniform1f(loc('u_canvasAspect'), this.canvas.width / Math.max(1, this.canvas.height));

    const bands = state.audioBands ?? { low: 0, mid: 0, high: 0 };
    gl.uniform1f(loc('u_time'), state.timeSec ?? 0);
    gl.uniform3f(loc('u_audioBands'), bands.low, bands.mid, bands.high);

    const fx = state.fxUniforms ?? {};
    gl.uniform1f(loc('u_fxBlur'), fx.u_fxBlur ?? 0);
    gl.uniform1f(loc('u_fxStrobe'), fx.u_fxStrobe ?? 0);
    gl.uniform1i(loc('u_fxMirrorMode'), fx.u_fxMirrorMode ?? 0);
    gl.uniform1f(loc('u_fxHue'), fx.u_fxHue ?? 0);
    gl.uniform1f(loc('u_fxBw'), fx.u_fxBw ?? 0);
    gl.uniform1f(loc('u_fxPixelate'), fx.u_fxPixelate ?? 0);
    gl.uniform1f(loc('u_fxAudioShader'), fx.u_fxAudioShader ?? 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private renderFallback2d(state: CompositorFrameState): void {
    const ctx = this.ctx2d;
    if (!ctx) return;
    const { width, height } = this.canvas;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    if (state.videoA && state.videoA.readyState >= 2 && state.mix < 1) {
      ctx.globalAlpha = 1 - state.mix;
      ctx.drawImage(state.videoA, 0, 0, width, height);
    }
    if (state.videoB && state.videoB.readyState >= 2 && state.mix > 0) {
      ctx.globalAlpha = state.mix;
      ctx.drawImage(state.videoB, 0, 0, width, height);
    }
    ctx.globalAlpha = 1;
    if (state.overlayCanvas) {
      ctx.drawImage(state.overlayCanvas, 0, 0, width, height);
    }
  }

  captureOutputStream(fps = 60): MediaStream {
    const stream = this.canvas.captureStream(fps);
    if (typeof stream?.getVideoTracks === 'function') {
      for (const track of stream.getVideoTracks()) {
        if ('contentHint' in track) {
          track.contentHint = 'motion';
        }
      }
    }
    return stream;
  }

  dispose(): void {
    if (this.gl) {
      for (const prog of this.programs.values()) {
        this.gl.deleteProgram(prog);
      }
      this.programs.clear();
      this.uniformCache.clear();
      this.gl = null;
    }
    this.ctx2d = null;
  }
}

