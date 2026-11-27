// src/main/java/com/zktracker/backend/security/DeviceRateLimitFilter.java
package com.zktracker.backend.security;

import io.github.bucket4j.Bandwidth;
import io.github.bucket4j.Bucket;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.crypto.SecretKey;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class DeviceRateLimitFilter extends OncePerRequestFilter {

    private final Map<String, Bucket> deviceBuckets = new ConcurrentHashMap<>();
    private final SecretKey signingKey;

    public DeviceRateLimitFilter(@Value("${app.jwt.secret}") String secret) {
        this.signingKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    private Bucket createNewBucket() {
        // Allow 10 batch categorization calls per hour per device
        Bandwidth limit = Bandwidth.builder()
                .capacity(10)
                .refillGreedy(10, Duration.ofHours(1))
                .build();
        return Bucket.builder().addLimit(limit).build();
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().equals("/api/v1/categorize")
                || "OPTIONS".equalsIgnoreCase(request.getMethod());
    }
    
    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String authHeader = request.getHeader("Authorization");
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            response.sendError(HttpStatus.UNAUTHORIZED.value(), "Missing scoped device JWT");
            return;
        }

        String deviceIdHash;
        try {
            String token = authHeader.substring(7).trim();
            Claims claims = Jwts.parser()
                    .verifyWith(signingKey)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
            deviceIdHash = claims.getSubject();
        } catch (Exception jwtEx) {
            response.sendError(HttpStatus.UNAUTHORIZED.value(), "Invalid or expired device token: " + jwtEx.getMessage());
            return;
        }

        Bucket bucket = deviceBuckets.computeIfAbsent(deviceIdHash, k -> createNewBucket());
        if (!bucket.tryConsume(1)) {
            response.sendError(HttpStatus.TOO_MANY_REQUESTS.value(), "Device token budget exhausted");
            return;
        }

        // Execute downstream controller OUTSIDE the JWT try-catch block!
        filterChain.doFilter(request, response);
    }

}
