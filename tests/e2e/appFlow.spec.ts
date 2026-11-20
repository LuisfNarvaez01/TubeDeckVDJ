import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';

const FORBIDDEN_MEDIA_EXTS = new Set(['.mp4', '.webm', '.m4a', '.mp3']);

function collectFilesRecursively(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFilesRecursively(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

test('Dual-window VDJ cabin launches cleanly, opens/closes Screen 2, and writes zero media files to disk', async () => {
  const tempUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tubedeck-e2e-'));
  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) cleanEnv[k] = v;
  }
  delete cleanEnv.ELECTRON_RUN_AS_NODE;
  delete cleanEnv.ELECTRON_RENDERER_URL;
  cleanEnv.TUBEDECK_USER_DATA_DIR = tempUserDataDir;

  const packagedExe = process.env.TUBEDECK_E2E_EXE;
  const app = await electron.launch(
    packagedExe
      ? { executablePath: packagedExe, env: cleanEnv }
      : { args: [path.resolve('out/main/index.js')], env: cleanEnv }
  );

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  try {
    const mainPage = await app.firstWindow();
    mainPage.on('pageerror', (err) => pageErrors.push(`main pageerror: ${err.message}`));
    mainPage.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(`main console.error: ${msg.text()}`);
      }
    });

    await mainPage.waitForLoadState('domcontentloaded');

    // 1. Verify all primary cabin panels & bottom tabs
    await expect(mainPage.getByRole('region', { name: 'Deck A', exact: true })).toBeVisible();
    await expect(mainPage.getByRole('region', { name: 'Deck B', exact: true })).toBeVisible();
    await expect(
      mainPage.getByRole('region', { name: 'Cabina de Video Master', exact: true })
    ).toBeVisible();
    await expect(mainPage.getByRole('region', { name: 'Mixer Central', exact: true })).toBeVisible();

    await expect(mainPage.getByRole('button', { name: 'Buscador YouTube' })).toBeVisible();
    await expect(mainPage.getByRole('button', { name: /^Cola/ })).toBeVisible();
    await expect(mainPage.getByRole('button', { name: 'Historial & Crates' })).toBeVisible();
    await expect(mainPage.getByRole('button', { name: 'Overlays & Visuales' })).toBeVisible();
    await expect(
      mainPage.getByRole('button', { name: 'Ajustes (Audio / Pantalla / MIDI)' })
    ).toBeVisible();

    // Verify VirtualDJ v2.0 Club Pro controls: Jog Wheels & AUTO MIX button
    await expect(mainPage.getByRole('slider', { name: 'Jog Wheel Deck A' })).toBeVisible();
    await expect(mainPage.getByRole('slider', { name: 'Jog Wheel Deck B' })).toBeVisible();
    await expect(mainPage.getByRole('button', { name: 'Auto Mix A B' })).toBeVisible();

    // Switch across bottom tabs without errors (including Cola + Radio YT & Updates card)
    await mainPage.getByRole('button', { name: /^Cola/ }).click();
    await expect(mainPage.getByRole('button', { name: /Radio YT:/i })).toBeVisible();
    await expect(mainPage.getByRole('combobox', { name: 'Estilo Automix' })).toBeVisible();

    await mainPage.getByRole('button', { name: 'Historial & Crates' }).click();
    await expect(mainPage.getByText(/Nueva Sesión|Sesiones/i).first()).toBeVisible();

    await mainPage.getByRole('button', { name: 'Ajustes (Audio / Pantalla / MIDI)' }).click();
    await expect(mainPage.getByText(/Resolución Master \(60 fps\)/i)).toBeVisible();
    await expect(mainPage.getByText(/Actualizaciones \(GitHub Releases\)/i)).toBeVisible();

    // 2. Open Secondary Output Window (Pantalla 2)
    const openBtn = mainPage.getByRole('button', { name: 'Abrir P2' });
    await expect(openBtn).toBeVisible();

    const outputWindowPromise = app.waitForEvent('window');
    await openBtn.click();
    const outputPage = await outputWindowPromise;

    outputPage.on('pageerror', (err) => pageErrors.push(`output pageerror: ${err.message}`));
    outputPage.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(`output console.error: ${msg.text()}`);
      }
    });

    await outputPage.waitForLoadState('domcontentloaded');
    expect(outputPage.url()).toContain('role=output');

    const outputVideo = outputPage.getByTestId('output-master-video');
    await expect(outputVideo).toBeAttached();
    const hasNativeControls = await outputVideo.evaluate(
      (el) => (el as HTMLVideoElement).controls
    );
    expect(hasNativeControls).toBe(false);

    // Main cabin toggle should reflect ON AIR state
    await expect(mainPage.getByRole('button', { name: 'Cerrar P2' })).toBeVisible();

    // 3. Closing Output window must keep Main cabin alive and reset toggle to 'Abrir P2'
    await outputPage.close();
    await expect(mainPage.getByRole('button', { name: 'Abrir P2' })).toBeVisible();
    await expect(mainPage.getByRole('region', { name: 'Deck A', exact: true })).toBeVisible();

    // 4. Verify SQLite metadata DB exists and ZERO media files were written to disk
    const userDataFiles = collectFilesRecursively(tempUserDataDir);
    const hasDb = userDataFiles.some((f) => path.basename(f) === 'tubedeck.db');
    expect(hasDb).toBe(true);

    const mediaFilesOnDisk = userDataFiles.filter((f) =>
      FORBIDDEN_MEDIA_EXTS.has(path.extname(f).toLowerCase())
    );
    expect(mediaFilesOnDisk).toEqual([]);

    expect(pageErrors).toEqual([]);
    const nonNetworkConsoleErrors = consoleErrors.filter(
      (e) => !/ERR_NAME_NOT_RESOLVED|Failed to fetch/i.test(e)
    );
    expect(nonNetworkConsoleErrors).toEqual([]);
  } finally {
    await app.close();
    fs.rmSync(tempUserDataDir, { recursive: true, force: true });
  }
});

