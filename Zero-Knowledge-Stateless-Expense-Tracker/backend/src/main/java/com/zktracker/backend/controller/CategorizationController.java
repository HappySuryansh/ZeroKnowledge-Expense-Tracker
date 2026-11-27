// src/main/java/com/zktracker/backend/controller/CategorizationController.java
package com.zktracker.backend.controller;

import com.zktracker.backend.dto.CategorizationRequest;
import com.zktracker.backend.dto.CategorizationResponse;
import com.zktracker.backend.service.CategorizationService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1")
@CrossOrigin(origins = "http://localhost:5173")
public class CategorizationController {

    private final CategorizationService categorizationService;

    public CategorizationController(CategorizationService categorizationService) {
        this.categorizationService = categorizationService;
    }

    @PostMapping("/categorize")
    public ResponseEntity<CategorizationResponse> categorize(
            @RequestBody CategorizationRequest request) {
        // Process purely in volatile stack/heap memory; no logging, no persistence
        Map<String, String> categoryMap = categorizationService.categorizeMerchants(request.merchants());
        return ResponseEntity.ok(new CategorizationResponse(categoryMap));
    }
}
