import { describe, it, expect, vi } from 'vitest';
import { TRANSITION_SHADERS } from '../../../src/renderer/video/transitions.glsl';
import {
  WebGLVideoCompositor,
  type VideoTransitionId
} from '../../../src/renderer/video/WebGLVideoCompositor';

function createMockWebGL2(): WebGL2RenderingContext {
  let idCounter = 1;
  return {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    TRIANGLE_STRIP: 0x0005,
    TEXTURE_2D: 0x0de1,
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
    TEXTURE2: 0x84c2,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    CLAMP_TO_EDGE: 0x812f,
    LINEAR: 0x2601,
    COLOR_BUFFER_BIT: 0x4000,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    createShader: vi.fn(() => ({ id: idCounter++ })),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ''),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({ id: idCounter++ })),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ''),
    useProgram: vi.fn(),
    deleteProgram: vi.fn(),
    createBuffer: vi.fn(() => ({ id: idCounter++ })),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    createVertexArray: vi.fn(() => ({ id: idCounter++ })),
    bindVertexArray: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    createTexture: vi.fn(() => ({ id: idCounter++ })),
    activeTexture: vi.fn(),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    pixelStorei: vi.fn(),
    texImage2D: vi.fn(),
    getUniformLocation: vi.fn((_p, name: string) => ({ name })),
    uniform1f: vi.fn(),
    uniform1i: vi.fn(),
    uniform2f: vi.fn(),
    uniform3f: vi.fn(),
    uniform4f: vi.fn(),
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    drawArrays: vi.fn()
  } as unknown as WebGL2RenderingContext;
}

describe('WebGLVideoCompositor & GLSL transitions', () => {
  it('provides valid GLSL 300 es fragment shaders for all 9 transition variants', () => {
    const ids: VideoTransitionId[] = [
      'dissolve',
      'wipe-h',
      'wipe-v',
      'wipe-diag',
      'zoom-push',
      'circle-iris',
      'luma-fade',
      'curtain-split',
      'slide'
    ];
    for (const id of ids) {
      expect(TRANSITION_SHADERS[id]).toContain('#version 300 es');
      expect(TRANSITION_SHADERS[id]).toContain('uniform float u_mix');
    }
  });

  it('computes smoothstep auto-transition progress and renders safely when decks are null', () => {
    const glMock = createMockWebGL2();
    const fakeCanvas = {
      width: 1280,
      height: 720,
      getContext: vi.fn((kind: string) => (kind === 'webgl2' ? glMock : null)),
      captureStream: vi.fn(() => ({} as MediaStream))
    } as unknown as HTMLCanvasElement;

    const compositor = new WebGLVideoCompositor(fakeCanvas);
    expect(compositor.init()).toBe(true);
    expect(compositor.stepAutoTransition(0.5, 'A')).toBeCloseTo(0.5, 4);
    expect(compositor.stepAutoTransition(1, 'B')).toBe(0);
    expect(compositor.stepAutoTransition(0.25, 'A')).toBeLessThan(0.25);

    compositor.renderFrame({
      mix: 0.4,
      transition: 'circle-iris',
      videoA: null,
      videoB: null,
      overlayCanvas: null
    });

    expect(glMock.drawArrays).toHaveBeenCalled();
    compositor.captureOutputStream(60);
    expect(fakeCanvas.captureStream).toHaveBeenCalledWith(60);
    compositor.dispose();
  });
});
