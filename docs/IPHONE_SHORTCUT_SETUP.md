# iPhone shortcut: log an expense when you close an app

When you close an app such as Swiggy, a few cards pop up: **Spent something? → which space → who shared it → amount → what for**. The expense is then added to Expense Tracker.

- Site: `https://ggn-expense-tracker.netlify.app`
- Steps marked **(New)** were added so you can pick who shared the expense. They need [PR #4](https://github.com/Piyush550/Expense-tracker/pull/4) to be deployed. Until then, leave them out, and the expense is split between everyone in the choice you pick.

## How to read the steps

| Words used | Meaning |
|---|---|
| **Search** `X` | Tap the search bar at the bottom of the shortcut editor ("Search Actions"), type `X`, and tap the result. The action is added at the end. |
| **Type** | Type the text yourself (plain text). |
| **Variable** | Insert a blue chip holding an earlier step's result. Tap the field; a bar of suggestions appears above the keyboard, so tap the one you need. If it isn't there, tap **Select Variable**, then tap the step it should come from. |
| **›** | The small arrow on an action that shows its extra options. |

**Tip:** to tell variables apart (several steps produce "Chosen Item" or "Provided Input"), rename them. Tap a step's icon or title → **Rename**. The names used below, in brackets, are suggestions.

---

## Before you start: create a key

1. Open `https://ggn-expense-tracker.netlify.app` and sign in.
2. Click your name at the bottom left → **iPhone & AI apps** → **Create key** → **Copy key**.

> **Important:** the key must have **no line break** after it. A line break makes every request fail with *"The network connection was lost."* When you paste it in step 1, make sure the cursor ends right after the last character, with nothing on the next line.

---

## Part A: build the "Log expense" shortcut

Open **Shortcuts** → **Shortcuts** tab → **+** (top right). Tap the title at the top → **Rename** → type `Log expense`.

### 1. Text: your key
- Search `Text` → tap **Text**.
- Tap the grey placeholder → **paste the key** (`et_…`). Delete any line break after it.

### 2. Choose from Menu: Yes / Skip
- Search `Choose from Menu`.
- **Prompt**: type `Spent something?`
- First option: type `Yes`. Second option: type `Skip`.
- The block now has three parts: **Yes**, **Skip** and **End Menu**.
- Search `Stop This Shortcut`, then press and drag it **under "Skip"** (between Skip and End Menu).
- Leave **Yes** empty. All the following steps go **after End Menu**.

### 3. Get Contents of URL: load your spaces
- Search `Get Contents of URL`. It must sit below **End Menu**.
- **URL**: type `https://ggn-expense-tracker.netlify.app/api/quick/options`
- **›** → **Method**: leave **GET**.
- **Headers** → **Add new header**:
  - Key: type `Authorization`
  - Value: type `Bearer` + **one space**, then insert the variable **Text** (step 1).
- **Request Body**: none. A GET must not have a body. (If you add one by mistake, set **Method** to **POST**; the address accepts both.)

### 4. Get Dictionary Value: the list of choices
- Search `Get Dictionary Value`. It should read *Get Value for Key in Dictionary*.
- **Key**: type `labels` (lowercase, no spaces).
- **Dictionary**: the variable **Contents of URL** from **step 3**.

### 5. Choose from List: which space
- Search `Choose from List`. Its input should be **Dictionary Value** (step 4).
- **›** → **Prompt**: type `Which space?`. Leave **Select Multiple** off.
- Suggested rename: **Space choice**.

### 6. Get Contents of URL: load the people **(New)**
- Search `Get Contents of URL`.
- **URL**: type `https://ggn-expense-tracker.netlify.app/api/quick/people`
- **›** → **Method**: **POST**.
- **Headers** → **Add new header**: Key `Authorization`; Value `Bearer ` + the variable **Text** (step 1), exactly as in step 3.
- **Request Body**: **JSON** → **Add new field** → **Text**:
  - Key: type `preset`
  - Value: the variable **Chosen Item** from **step 5** (Space choice).

### 7. Choose from List: who shared it **(New)**
- Search `Choose from List`. Its input should be **Contents of URL** from **step 6**. If it isn't: Select Variable → tap step 6.
- **›**:
  - **Prompt**: type `Who shared it?`
  - Turn **Select Multiple** on.
  - Optional: turn **Select All Initially** on, if you usually split with everyone and only untick a few.
- Suggested rename: **People choice**.

### 8. Ask for Input: amount
- Search `Ask for Input`. Change **Text** to **Number**.
- **Prompt**: type `Amount (₹)`
- **›**: **Allow Decimal Numbers** on, **Allow Negative Numbers** off.
- Suggested rename: **Amount**.

### 9. Ask for Input: what for
- Search `Ask for Input`. Leave it as **Text**.
- **Prompt**: type `What for?`
- **›** → **Default Answer**: the variable **Shortcut Input**. This is the app name the automation passes in, e.g. "Swiggy".
- If a line *"Receive … input"* appears at the top of the shortcut, set "If there's no input" to **Continue**.
- Suggested rename: **Title**.

### 10. Get Contents of URL: save the expense
- Search `Get Contents of URL`.
- **URL**: type `https://ggn-expense-tracker.netlify.app/api/quick/expense`
- **›** → **Method**: **POST** (not GET, or you'll get "No such API route").
- **Headers** → **Add new header**: Key `Authorization`; Value `Bearer ` + the variable **Text** (step 1).
- **Request Body**: **JSON**, then add these fields (**Add new field**, pick the type first):

  | Type | Key (type it) | Value (variable) |
  |---|---|---|
  | Text | `preset` | **Chosen Item** from **step 5** (Space choice) |
  | Number | `amount` | **Provided Input** from **step 8** (Amount) |
  | Text | `title` | **Provided Input** from **step 9** (Title) |
  | Text | `people` **(New)** | **Chosen Item** from **step 7** (People choice) |

  If you tick nobody in step 7, the expense is split between everyone in the step 5 choice.

### 11. Get Dictionary Value: the result message
- Search `Get Dictionary Value`.
- **Key**: type `message`
- **Dictionary**: **Contents of URL** from **step 10**, the one directly above. Not step 3 or step 6.

### 12. Show Notification
- Search `Show Notification`.
- Message: delete any default text, then insert the variable **Dictionary Value** (step 11).
- Optional: **›** → **Title**: type `Expense Tracker`.

**Test:** tap **▶**. The first time, iOS asks to connect to `ggn-expense-tracker.netlify.app`; tap **Always Allow**. You should end with *"Added ₹… to … · split N ways"*.

---

## Part B: pop up when you close an app

1. Shortcuts → **Automation** tab → **+** (or **New Automation**).
2. Tap **App** → **Choose** → tick **Swiggy** → **Done**.
3. Untick **Is Opened**, tick **Is Closed**.
4. Choose **Run Immediately**, and turn **Notify When Run** off. Tap **Next**.
5. **New Blank Automation** → **Add Action**:
   - Search `Text` → type `Swiggy`
   - Search `Run Shortcut` → **Shortcut**: **Log expense** → **Input**: the variable **Text** (just above).
6. **Done**.

Repeat for each app (Zomato, Uber, Blinkit, …), changing only the Text to that app's name.

---

## Troubleshooting

| You see | Cause | Fix |
|---|---|---|
| *The network connection was lost* (at step 3, 6 or 10) | A line break inside the `Authorization` header, usually after the key in step 1 | Delete the line break after the key in step 1, or type `Bearer et_…` directly in each header on one line |
| *No such API route* | A **GET** sent to an address that only accepts **POST** | Set **Method: POST** in step 6 or step 10 |
| Skips "Which space?" straight to the amount, then *preset: Too small* | Step 4 returned nothing | Step 4 key must be exactly `labels`, and its Dictionary must be step 3's **Contents of URL** |
| *Couldn't add the expense: That choice is not available any more* | `preset` in step 10 isn't the step 5 choice | Point `preset` at **Chosen Item from step 5** |
| *Couldn't add the expense: "X" is not in <space>* | `people` holds a name that isn't in the chosen space, or points at the wrong step | Point `people` at **Chosen Item from step 7** |
| *Couldn't load …: This key is not valid any more* | The key was revoked, regenerated or expired | Create a new key and paste it in step 1 |
| A blank notification | Step 11 reads the wrong step | Step 11's Dictionary must be **step 10's** Contents of URL |
| The automation doesn't fire | Trigger settings | **Is Closed** ticked, **Run Immediately** on |

**Lost phone?** Revoke the key: sign in → your name at the bottom left → **iPhone & AI apps** → **Revoke**. The shortcut stops working immediately.
