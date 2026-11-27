// src/main/java/com/zktracker/backend/dto/CategorizationRequest.java
package com.zktracker.backend.dto;

import java.util.List;

public record CategorizationRequest(List<String> merchants) {}