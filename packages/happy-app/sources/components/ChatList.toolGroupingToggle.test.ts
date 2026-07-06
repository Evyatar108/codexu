/**
 * R8 stage2 (catalogue HA-5): the chat tool-grouping toggle.
 *
 * Operator decision #2 restored upstream's tool-call/agent-work grouping as an
 * OPT-IN path behind a local setting whose DEFAULT preserves the fork's flat
 * e-ink rendering. These assertions pin that contract so a future edit can't
 * silently flip the default and regress every e-ink device to grouped mode.
 */
import { describe, expect, it } from 'vitest';
import {
    LocalSettingsSchema,
    localSettingsDefaults,
    localSettingsParse,
} from '../sync/localSettings';

describe('chatToolGrouping local setting (R8 stage2 / HA-5)', () => {
    it("defaults to 'flat' — the fork's current behavior-preserving rendering", () => {
        expect(localSettingsDefaults.chatToolGrouping).toBe('flat');
    });

    it("schema accepts both 'flat' and 'grouped'", () => {
        expect(LocalSettingsSchema.shape.chatToolGrouping.parse('flat')).toBe('flat');
        expect(LocalSettingsSchema.shape.chatToolGrouping.parse('grouped')).toBe('grouped');
    });

    it('rejects any other value at the schema level', () => {
        expect(LocalSettingsSchema.shape.chatToolGrouping.safeParse('collapsed').success).toBe(false);
    });

    it("localSettingsParse falls back to 'flat' when the key is absent", () => {
        const parsed = localSettingsParse({});
        expect(parsed.chatToolGrouping).toBe('flat');
    });

    it("localSettingsParse round-trips an explicit 'grouped' selection", () => {
        const parsed = localSettingsParse({ chatToolGrouping: 'grouped' });
        expect(parsed.chatToolGrouping).toBe('grouped');
    });
});
