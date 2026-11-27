// src/main/java/com/zktracker/backend/controller/DeviceAuthController.java
package com.zktracker.backend.controller;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Date;
import java.util.HexFormat;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/auth")
@CrossOrigin(origins = "http://localhost:5173")
public class DeviceAuthController {

    private final SecretKey signingKey;

    public DeviceAuthController(@Value("${app.jwt.secret}") String secret) {
        this.signingKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    @PostMapping("/device-register")
    public ResponseEntity<Map<String, String>> registerDevice(@RequestBody Map<String, String> body) throws Exception {
        String deviceSecret = body.get("deviceSecret");
        if (deviceSecret == null || deviceSecret.isBlank()) {
            return ResponseEntity.badRequest().build();
        }

        // Hash the device secret so even the JWT subject is anonymized
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        String deviceHash = HexFormat.of().formatHex(digest.digest(deviceSecret.getBytes(StandardCharsets.UTF_8)));

        String jwt = Jwts.builder()
                .subject(deviceHash)
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + 86400000L * 7)) // 7 days
                .signWith(signingKey)
                .compact();

        return ResponseEntity.ok(Map.of("token", jwt));
    }
}