import {defineConfig} from "@playwright/test";
import {resolve} from "node:path";
import {videoCámara} from "./playwright.probador.config";

export default defineConfig({
  testDir:"./pruebas/recursos-navegador", workers:1, fullyParallel:false,
  timeout:780_000, expect:{timeout:120_000}, reporter:"list",
  outputDir:"test-results-recursos",
  use:{baseURL:process.env["CLB_E2E_BASEURL"],channel:"chrome",headless:true,
    viewport:{width:1360,height:1000},permissions:["camera"],trace:"retain-on-failure",
    launchOptions:{args:["--use-fake-device-for-media-stream",`--use-file-for-fake-video-capture=${resolve(videoCámara)}`]}},
});
