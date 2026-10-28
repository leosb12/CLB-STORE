import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./pruebas/material-navegador',workers:1,timeout:240_000,expect:{timeout:90_000},reporter:'list',outputDir:'test-results-material',use:{baseURL:'http://127.0.0.1:14200',channel:'chrome',headless:true,viewport:{width:1360,height:1000},trace:'retain-on-failure'}});
