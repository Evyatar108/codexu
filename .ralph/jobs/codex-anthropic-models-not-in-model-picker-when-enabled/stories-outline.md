# Stories Outline: Anthropic cache-aware model catalog

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Add cache identity eligibility to the models manager

**Description:** As a Codex user, I want the models cache to distinguish request-shaping provider state so a fresh cache from one catalog shape is not reused for another.

**Acceptance Criteria:**

- [ ] `models_cache.json` records optional provider/request-shaping identity metadata without breaking legacy cache deserialization.
- [ ] `ModelsCacheManager::load_fresh()` rejects a fresh cache when an expected identity is present and the cached identity differs or is missing.
- [ ] `OpenAiModelsManager::try_load_cache()` passes the endpoint identity into cache eligibility, and `fetch_and_update_models()` persists the same identity with fetched models.
- [ ] Providers that do not supply a cache identity retain existing client-version and 300s TTL behavior.
- [ ] A unit test proves a matching identity fresh cache avoids a second model fetch.
- [ ] Typecheck and targeted `codex-models-manager` tests pass.

**Dependencies:** None

**Estimated complexity:** medium

## US-002: Wire Copilot Anthropic gate identity and regression coverage

**Description:** As a Copilot-backed Codex user, I want enabling Anthropic models to refetch/refilter the Copilot model catalog when the current cache was created while Anthropic was disabled.

**Acceptance Criteria:**

- [ ] `CopilotModelsEndpoint` supplies a cache identity that includes provider id `copilot` and the resolved `anthropic_models_resolved()` state.
- [ ] The existing picker filter in `copilot_models_endpoint.rs` remains behaviorally unchanged: GPT `/responses` rows pass in both states; chat-only Claude rows pass only when Anthropic is enabled.
- [ ] A no-network regression test seeds a feature-off cache with only GPT, then constructs a feature-on manager with a mocked `/models` response containing GPT plus Claude, and proves `OnlineIfUncached` refetches and includes Claude.
- [ ] The regression also proves unchanged gate identity does not refetch within the 300s TTL.
- [ ] Existing endpoint tests for `chat_only_row_hidden_until_anthropic_enabled` and cache round-trip behavior remain green.
- [ ] `codex\docs\implementation\patch-surface.md` records the new SANDBOX PATCH invariant and rebase replant note for cache identity eligibility.
- [ ] Typecheck and targeted `codex-model-provider` tests pass.

**Dependencies:** US-001

**Estimated complexity:** medium
