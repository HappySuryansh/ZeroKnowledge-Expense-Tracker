// src/main/java/com/zktracker/backend/service/CategorizationService.java
package com.zktracker.backend.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class CategorizationService {

    private static final Logger log = LoggerFactory.getLogger(CategorizationService.class);
    private final ChatClient chatClient;
    private static final int BATCH_SIZE = 100;

    private static final String SYSTEM_PROMPT = """
            You are a strict financial transaction classifier for Indian bank statements.
            Classify each input string into EXACTLY ONE of these categories:
            - Groceries & Quick Commerce (e.g., Blinkit, Mother D, MAMA GEN)
            - Food & Dining (e.g., SWIGGY I, HIRO FOODS, HiraSwee, SHRI BIK)
            - Transit & Travel (e.g., DMRC, DELHI ME, IRCTC Ti, Indian R)
            - Investments & Mutual Funds (e.g., ACHDr HDFC00070 PPFAS)
            - Bills, Telecom & Recharges (e.g., Jio Prep, Google P, Reliance)
            - Government & Exam Fees (e.g., Union Pu, INB E mandate OF GOVT CORP PAYMENTS)
            - Micro-Wallet & Cashbacks (e.g., UPILITE, NPCI BHIM, BHIM)
            - Peer-to-Peer / Personal Transfer (e.g., RINKI P, NAWNIT K, SUNIL, Ritik Raj, individual names)
            - Miscellaneous (e.g., CR, INTERES T, bank charges, cash withdrawals, interest credits)

            CRITICAL CONTRACT RULES:
            1. Return ONLY a valid JSON object mapping each input string to its category.
            2. EVERY key in your JSON response MUST BE A 100% EXACT, VERBATIM, CHARACTER-FOR-CHARACTER COPY of a string in the input array.
            3. NEVER merge, join, concatenate, or combine multiple items into one key (e.g., if input contains "CR" and "INTERES T", you MUST return "CR": "..." and "INTERES T": "..." separately; NEVER merge them into "CRINTERES T").
            4. NEVER correct typos, fix spelling, complete truncated names, or alter any characters (e.g., if input is "ARUN KUM", the key MUST remain "ARUN KUM", never "ARUN KUMAR"; if input is "R K YADA", it MUST remain "R K YADA").
            5. The output JSON must have EXACTLY the same number of keys as the input array.
            """;

    public CategorizationService(ChatClient.Builder chatClientBuilder) {
        this.chatClient = chatClientBuilder
                .defaultSystem(SYSTEM_PROMPT)
                .build();
    }

    public Map<String, String> categorizeMerchants(List<String> merchants) {
        if (merchants == null || merchants.isEmpty()) {
            return Collections.emptyMap();
        }

        Map<String, String> aggregatedMap = new ConcurrentHashMap<>();
        int totalBatches = (int) Math.ceil((double) merchants.size() / BATCH_SIZE);

        log.info("Starting categorization for {} merchants in batches of {} ({} batch(es))", 
                merchants.size(), BATCH_SIZE, totalBatches);

        if (totalBatches == 1) {
            categorizeBatch(merchants, 1, 1, aggregatedMap);
        } else {
            List<CompletableFuture<Void>> futures = new ArrayList<>();
            for (int i = 0; i < merchants.size(); i += BATCH_SIZE) {
                List<String> batch = merchants.subList(i, Math.min(i + BATCH_SIZE, merchants.size()));
                int batchIndex = (i / BATCH_SIZE) + 1;

                futures.add(CompletableFuture.runAsync(() -> 
                    categorizeBatch(batch, batchIndex, totalBatches, aggregatedMap)
                ));
            }
            CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();
        }

        log.info("Completed categorization. Total mappings: {}", aggregatedMap.size());
        return aggregatedMap;
    }

    private void categorizeBatch(List<String> batch, int batchIndex, int totalBatches, Map<String, String> targetMap) {
        log.info("Sending batch {}/{} ({} merchants) to Gemini...", batchIndex, totalBatches, batch.size());
        try {
            Map<String, String> batchResult = chatClient.prompt()
                    .user(u -> u.text("Categorize this JSON array of merchants:\n{merchants}")
                            .param("merchants", batch))
                    .call()
                    .entity(new ParameterizedTypeReference<Map<String, String>>() {});

            if (batchResult != null) {
                log.info("Batch {}/{} successfully categorized (received {} mappings)", 
                        batchIndex, totalBatches, batchResult.size());
                targetMap.putAll(batchResult);
            } else {
                log.warn("Batch {}/{} returned null response", batchIndex, totalBatches);
            }
        } catch (Exception e) {
            log.error("Failed to categorize batch {}/{}: {}", batchIndex, totalBatches, e.getMessage(), e);
            throw new RuntimeException("LLM categorization failed on batch " + batchIndex + ": " + e.getMessage(), e);
        }
    }
}
