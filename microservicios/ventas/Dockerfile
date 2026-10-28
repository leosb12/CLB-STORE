# syntax=docker/dockerfile:1
FROM maven:3.9-eclipse-temurin-21 AS compilacion
WORKDIR /app
COPY pom.xml ./
RUN --mount=type=cache,id=clb_maven,target=/root/.m2 mvn -q -B dependency:go-offline
COPY src ./src
# Las pruebas de integración requieren PostgreSQL; se ejecutan fuera de la imagen (ver LEEME).
RUN --mount=type=cache,id=clb_maven,target=/root/.m2 mvn -q -B -DskipTests package && cp target/ventas-*.jar /app/clb-ventas.jar

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd --system --uid 10001 clb
COPY --from=compilacion /app/clb-ventas.jar ./clb-ventas.jar
USER clb
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=8s --start-period=40s --retries=10 \
  CMD curl -fsS "http://127.0.0.1:${CLB_VENTAS_PUERTO_INTERNO:-8080}/salud" > /dev/null || exit 1
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=60", "-jar", "/app/clb-ventas.jar"]
