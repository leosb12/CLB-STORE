# R19 — Especificación ICONIX de CLB Store

Versión: 2026-10-27. Actores principales: Cliente, Administrador y Servicio interno autenticado. Actores de apoyo: Keycloak y automatización n8n. El worker de IA es un colaborador interno del caso de uso, no un usuario humano.

La especificación describe el alcance implementado y señala la ampliación fotográfica todavía desactivada. No convierte pruebas pendientes ni algoritmos experimentales en requisitos satisfechos.

## Artefactos

1. [Requisitos y trazabilidad](trazabilidad.md).
2. [Modelo de dominio y clases](modelo-dominio.md).
3. [Casos de uso y cursos alternativos](casos-de-uso.md).
4. [Análisis de robustez](robustez.md).
5. [Diseño de secuencias](secuencias.md).
6. [Clases de diseño con operaciones](clases-diseno.md), derivadas de las secuencias.

Los diagramas Mermaid y el texto se versionan junto al código. Son fuente editable y revisable; no se ha comprobado su importación en Enterprise Architect o StarUML ni generado un proyecto nativo de esas herramientas. El formato final institucional requiere esa comprobación si es exigido por el docente.

## Recorrido de ICONIX

Requisito → caso de uso con pre/postcondiciones y alternativos → robustez (boundary/control/entity) → secuencia con colaboraciones concretas → clases y contratos → prueba y demo. Las entidades del análisis son conceptos de dominio; las tablas de persistencia y pantallas no se confunden con ellas.

La trazabilidad incluye los cinco casos principales establecidos por el equipo. CU04.9 amplía Administración con preparación/publicación de recursos de prenda. R17 se documenta separadamente en `docs/arquitectura`.
