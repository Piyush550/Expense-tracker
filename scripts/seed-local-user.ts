// Creates only the local login; safe to rerun without duplicating spaces or expenses.
import { ensureLocalTestAccount, LOCAL_TEST_ACCOUNT } from "./local-test-account";

await ensureLocalTestAccount();
console.log(`Local emulator account ready: ${LOCAL_TEST_ACCOUNT.email} / ${LOCAL_TEST_ACCOUNT.password}`);
