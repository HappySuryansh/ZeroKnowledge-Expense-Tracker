# Upgrade Plan: ZkExpenseTracker (direct execution; session telemetry unavailable)

- **Generated**: 2026-11-18 20:11 +05:30
- **HEAD Branch**: N/A (workspace is not a git repository)
- **HEAD Commit ID**: N/A (workspace is not a git repository)

## Available Tools

**JDKs**
- JDK 17: `C:\Program Files\Eclipse Adoptium\jdk-17.0.20.8-hotspot` (installed, not the project's base JDK)
- JDK 21: not available (baseline will be skipped)
- JDK 25: **<TO_BE_INSTALLED>** (required for compilation and tests; installation attempted but download throughput made it impractical)

**Build Tools**
- Maven Wrapper: 3.10.0 (`backend/.mvn/wrapper/maven-wrapper.properties`; available, but wrapper startup did not complete)

## Guidelines

> Note: You can add any specific guidelines or constraints for the upgrade process here if needed, bullet points are preferred.

## Options

- Working branch: N/A (version control unavailable)
- Run tests before and after the upgrade: true

## Upgrade Goals

- Java/JDK: 25 (latest LTS)

## Technology Stack

| Technology/Dependency | Current | Min Compatible Version | Why Incompatible |
| ---------------------- | ------- | ---------------------- | ---------------- |
| Java | 21 | 25 | User requested |
| Spring Boot | 3.4.3 | 3.4.3 | Java 25 target; no observed source/API incompatibilities |
| Maven Wrapper | 3.10.0 | 3.9.0 | Already exceeds recommended Maven version |
| Maven Compiler Plugin (Spring Boot managed) | Spring Boot-managed | unchanged | No project-specific compiler plugin incompatibility identified |

## Derived Upgrades

- Keep the wrapper and Spring Boot dependency versions unchanged: this is a JDK-only target and no incompatibility was observed requiring framework or build-tool upgrades.

## Impact Analysis

### Dependency Changes

| File | Dependency | Current | Action | Target | Reason |
|------|-----------|---------|--------|--------|--------|
| `backend/pom.xml` | `java.version` | 21 | upgrade | 25 | Compile and run on requested LTS JDK |

### Source Code Changes

| File | Location | Current | Required Change | Reason |
|------|----------|---------|----------------|--------|
| None | — | — | No source changes identified | Compatibility scan found no JDK-internal APIs, removed APIs, or source patterns requiring migration |

### Configuration Changes

| File | Property/Setting | Current | Required Change | Reason |
|------|------------------|---------|----------------|--------|
| None | — | — | No application setting change identified | Runtime settings are independent of the Java compiler target |

### CI/CD Changes

| File | Location | Current | Required Change |
|------|----------|---------|----------------|
| None found | — | No Java version references found | No CI/CD Java setting to update |

### Risks & Warnings

- The local JDK 25 download from the official Adoptium API was attempted but transferred under 2 MB in about 80 seconds; no JDK 25 installer became available. **Mitigation**: install JDK 25 through a machine package manager or a faster official Adoptium mirror, then rerun the wrapper build and tests.
- JDK 21 is not installed, so a baseline build/test run cannot be performed.
- Maven Wrapper 3.10.0 startup did not complete in the available environment; wrapper distribution/network access must be checked alongside JDK installation.

## Upgrade Steps

- Step 1: Setup Environment
  - **Rationale**: JDK 25 is needed for target compilation and runtime validation.
  - **Changes to Make**: Install JDK 25. If installation fails, continue in degraded mode.
  - **Verification**: `java -version` using JDK 25; expected output reports version 25.

- Step 2: Setup Baseline
  - **Rationale**: Record pre-upgrade compilation and test behavior when the project's current JDK is available.
  - **Changes to Make**: None.
  - **Verification**: Skip because JDK 21 is unavailable.

- Step 3: Set Java target to 25
  - **Rationale**: Set Maven/Spring Boot compilation to the requested JDK.
  - **Changes to Make**: Apply the Dependency Changes table.
  - **Verification**: `.\mvnw.cmd clean test-compile -q` under JDK 25.

- Step 4: Final Validation
  - **Rationale**: Confirm clean compilation and all tests under the target JDK.
  - **Changes to Make**: Fix any validation failures; run tests and dependency vulnerability validation when tools/network are available.
  - **Verification**: `.\mvnw.cmd clean test -q` under JDK 25. In degraded mode, skip build/test commands and record the manual verification requirement.
