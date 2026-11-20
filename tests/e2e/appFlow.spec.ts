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

test('Dual-window VDJ v2.1 cabin launches cleanly, opens Guide/Marcos/Ajustes drawers and Screen 2, and writes zero media files to disk', async () => {
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

    // 0. First run: the radio taste setup ("10 reference songs") opens and can be skipped
    const tasteDialog = mainPage.getByRole('dialog', { name: 'Ajustar mi radio' });
    await expect(tasteDialog).toBeVisible();
    await expect(tasteDialog.getByText('Enséñale a la radio lo que pones')).toBeVisible();
    await tasteDialog.getByRole('button', { name: 'Omitir por ahora' }).click();
    await expect(tasteDialog).toBeHidden();

    // 1. Verify all primary cabin panels, Top Bar actions, and 4 bottom tabs
    await expect(mainPage.getByRole('region', { name: 'Deck A', exact: true })).toBeVisible();
    await expect(mainPage.getByRole('region', { name: 'Deck B', exact: true })).toBeVisible();
    await expect(
      mainPage.getByRole('region', { name: 'Cabina de Video Master', exact: true })
    ).toBeVisible();
    await expect(mainPage.getByRole('region', { name: 'Mixer Central', exact: true })).toBeVisible();
    await expect(mainPage.getByRole('region', { name: 'Controles Deck A', exact: true })).toBeVisible();
    await expect(mainPage.getByRole('region', { name: 'Controles Deck B', exact: true })).toBeVisible();

    await expect(mainPage.getByRole('combobox', { name: 'Calidad Video Global' })).toBeVisible();
    const keysBtn = mainPage.getByRole('button', { name: 'Mostrar Atajos' });
    await expect(keysBtn).toBeVisible();
    await keysBtn.click();
    await expect(keysBtn).toHaveAttribute('aria-pressed', 'true');
    await keysBtn.click();
    await expect(keysBtn).toHaveAttribute('aria-pressed', 'false');

    const headerMarcosBtn = mainPage.getByRole('banner').getByRole('button', { name: 'Marcos', exact: true });
    await expect(headerMarcosBtn).toBeVisible();
    await expect(mainPage.getByRole('button', { name: 'Guía', exact: true })).toBeVisible();
    await expect(mainPage.getByRole('button', { name: 'Ajustes', exact: true })).toBeVisible();

    await expect(mainPage.getByRole('button', { name: 'Buscador YouTube' })).toBeVisible();
    await expect(mainPage.getByRole('button', { name: /^Biblioteca Local/ })).toBeVisible();
    const upNext = mainPage.getByRole('complementary', { name: 'Siguiente' });
    await expect(upNext).toBeVisible();
    await expect(mainPage.getByRole('button', { name: 'Historial & Crates' })).toBeVisible();

    // Verify Jog Wheels & AUTO MIX button
    await expect(mainPage.getByRole('slider', { name: 'Jog Wheel Deck A' })).toBeVisible();
    await expect(mainPage.getByRole('slider', { name: 'Jog Wheel Deck B' })).toBeVisible();
    await expect(mainPage.getByRole('button', { name: 'Auto Mix A B' })).toBeVisible();

    // Test Top Bar Interactive Guide Modal
    await mainPage.getByRole('button', { name: 'Guía', exact: true }).click();
    await expect(mainPage.getByRole('dialog', { name: 'Guía de Cabina' })).toBeVisible();
    await mainPage.getByRole('button', { name: 'Cerrar Guía' }).click();
    await expect(mainPage.getByRole('dialog', { name: 'Guía de Cabina' })).toBeHidden();

    // Test Top Bar Marcos Drawer
    await headerMarcosBtn.click();
    const marcosDialog = mainPage.getByRole('dialog', { name: 'Marcos y Visuales' });
    await expect(marcosDialog).toBeVisible();
    await expect(marcosDialog.getByRole('button', { name: 'Karaoke' })).toBeVisible();
    await mainPage.getByRole('button', { name: 'Cerrar Marcos' }).click();
    await expect(marcosDialog).toBeHidden();

    // Test Top Bar Ajustes Drawer
    await mainPage.getByRole('button', { name: 'Ajustes', exact: true }).click();
    await expect(mainPage.getByRole('dialog', { name: 'Ajustes del Sistema' })).toBeVisible();
    await expect(mainPage.getByText(/Resolución Master \(60 fps\)/i)).toBeVisible();
    await expect(mainPage.getByText(/Actualizaciones \(GitHub Releases\)/i)).toBeVisible();
    await mainPage.getByRole('button', { name: 'Cerrar Ajustes' }).click();
    await expect(mainPage.getByRole('dialog', { name: 'Ajustes del Sistema' })).toBeHidden();

    // Switch across the bottom browser tabs
    await mainPage.getByRole('button', { name: /^Biblioteca Local/ }).click();
    await expect(mainPage.getByRole('button', { name: 'Agregar Archivos' })).toBeVisible();
    await expect(mainPage.getByRole('button', { name: 'Agregar Carpeta' })).toBeVisible();

    // The "Siguiente" (Up Next) column is always visible next to the browser tabs
    await expect(upNext.getByRole('button', { name: /Radio YT:/i })).toBeVisible();
    await upNext.getByRole('button', { name: 'Opciones de cola' }).click();
    await expect(upNext.getByRole('combobox', { name: 'Estilo Automix' })).toBeVisible();
    await expect(upNext.getByRole('button', { name: 'Vaciar Cola' })).toBeVisible();

    // Browser dock can be enlarged and restored
    await mainPage.getByRole('button', { name: 'Ampliar navegador' }).click();
    await expect(mainPage.getByRole('button', { name: 'Cabina completa' })).toBeVisible();
    await mainPage.getByRole('button', { name: 'Cabina completa' }).click();

    await mainPage.getByRole('button', { name: 'Historial & Crates' }).click();
    await expect(mainPage.getByText(/Nueva Sesión|Sesiones/i).first()).toBeVisible();

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
