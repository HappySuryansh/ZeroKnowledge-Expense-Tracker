# Multi-stage Dockerfile for Zero-Knowledge Expense Tracker
# Serves both the Spring Boot Stateless API and the integrated Zero-Knowledge Web UI
# on the same origin (zero CORS issues, zero modifications to existing source files).

FROM maven:3.9-eclipse-temurin-25 AS builder
WORKDIR /app/backend

COPY backend/pom.xml backend/pom.xml
COPY backend/src backend/src

RUN mvn -f backend/pom.xml clean package -DskipTests

FROM eclipse-temurin:25-jre
WORKDIR /app

COPY --from=builder /app/backend/target/backend-*.jar app.jar

EXPOSE 8080

# Honor dynamic $PORT on Render / Railway / Fly.io without modifying application.yml
ENTRYPOINT ["sh", "-c", "java -jar /app/app.jar --server.port=${PORT:-8080}"]
