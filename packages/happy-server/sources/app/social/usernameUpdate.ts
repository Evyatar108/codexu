import { allocateUpdateSeq } from "@/storage/seq";
import { buildUpdateAccountUpdate, type EventRouter } from "@/app/events/eventRouter";
import { randomKeyNaked } from "@/utils/randomKeyNaked";

const LOCAL_ACCOUNT_ID = "local-user";

export async function usernameUpdate(username: string, eventRouter: EventRouter): Promise<void> {
    // Send account update to all user connections
    const updSeq = await allocateUpdateSeq();
    const updatePayload = buildUpdateAccountUpdate(LOCAL_ACCOUNT_ID, { username: username }, updSeq, randomKeyNaked(12));
    eventRouter.emitUpdate({
        payload: updatePayload,
        recipientFilter: { type: 'user-scoped-only' }
    });
}
