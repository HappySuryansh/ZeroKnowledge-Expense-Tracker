FROM maven:3-eclipse-temurin-21 AS builder
WORKDIR /app

COPY backend/pom.xml backend/pom.xml
COPY backend/src backend/src

RUN mvn -f backend/pom.xml clean package -DskipTests -Djava.version=21 -Dmaven.compiler.release=21

FROM eclipse-temurin:21-jre
WORKDIR /app

COPY --from=builder /app/backend/target/backend-*.jar app.jar

EXPOSE 8080

ENTRYPOINT ["sh", "-c", "java -jar /app/app.jar --server.port=${PORT:-8080}"]
