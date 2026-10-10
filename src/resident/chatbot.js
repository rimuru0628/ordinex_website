/**
 * Resident Chatbot  `src/resident/chatbot.js`
 *
 * Provides an Ollama-powered chat UI for ordinance questions.
 * Lazily initialised by `resident/app.js` when the Chatbot tab is activated.
 *
 * Public API:
 *   init(container, uid)      renders the full chat UI into `container`
 *   appendMessage(history, message)  pure helper: returns new array with message appended
 *   getChatHistory()          returns the current in-memory chat history array
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Base URL for the Ollama HTTP API. Resolved from the Vite env at build time. */
const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL ?? 'http://localhost:11434';

/** Model identifier sent with every request. */
const MODEL = 'llama3.2';

/** System prompt injected at the start of every conversation. */
const systemMessage = {
  role: 'system',
  content:
    'You are an assistant for Bacnotan municipal ordinances. ' +
    'Answer questions clearly and accurately based on local government rules, ' +
    'regulations, and ordinances. If you are unsure, say so rather than guessing.',
};

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/**
 * In-memory chat history for the current session.
 * Each entry: { role: 'user' | 'assistant', content: string }
 *
 * @type {Array<{ role: string, content: string }>}
 */
let chatHistory = [];

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Pure function  returns a **new** array with `message` appended to `history`.
 * Does not mutate the original array.
 *
 * @param {Array<{ role: string, content: string }>} history
 * @param {{ role: string, content: string }} message
 * @returns {Array<{ role: string, content: string }>}
 */
export function appendMessage(history, message) {
  return [...history, message];
}

/**
 * Returns the current module-level chat history array.
 * Primarily used for testing.
 *
 * @returns {Array<{ role: string, content: string }>}
 */
export function getChatHistory() {
  return chatHistory;
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/**
 * Creates and returns a bubble `<div>` element.
 *
 * @param {string} text       - Message text content.
 * @param {string} extraClass - Additional BEM modifier class (e.g. 'bubble--user').
 * @returns {HTMLDivElement}
 */
function createBubble(text, extraClass) {
  const bubble = document.createElement('div');
  bubble.className = `bubble ${extraClass}`;
  bubble.textContent = text;
  return bubble;
}

/**
 * Creates and returns an animated loading bubble with three pulsing dots.
 *
 * @returns {HTMLDivElement}
 */
function createLoaderBubble() {
  const bubble = document.createElement('div');
  bubble.className = 'bubble bubble--loading';

  const dots = document.createElement('div');
  dots.className = 'loading-dots';
  dots.setAttribute('aria-label', 'Loading response');

  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    dots.appendChild(dot);
  }

  bubble.appendChild(dots);
  return bubble;
}

/**
 * Scrolls the messages container to the very bottom.
 *
 * @param {HTMLElement} messagesEl
 */
function scrollToBottom(messagesEl) {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ---------------------------------------------------------------------------
// Send flow
// ---------------------------------------------------------------------------

/**
 * Handles the full send flow:
 *  1. Read and trim input value; bail if empty.
 *  2. Append user message to history and render user bubble.
 *  3. Clear input and show loader.
 *  4. POST to Ollama `/api/chat`.
 *  5. Remove loader; render assistant or error bubble.
 *  6. Scroll to bottom.
 *
 * @param {HTMLInputElement} inputEl
 * @param {HTMLElement}      messagesEl
 */
async function handleSend(inputEl, messagesEl) {
  const text = inputEl.value.trim();
  if (!text) return;

  // 1. Append user message to history
  const userMessage = { role: 'user', content: text };
  chatHistory = appendMessage(chatHistory, userMessage);

  // 2. Render user bubble
  const userBubble = createBubble(text, 'bubble--user');
  messagesEl.appendChild(userBubble);

  // 3. Clear input
  inputEl.value = '';

  // 4. Show animated loader
  const loaderBubble = createLoaderBubble();
  messagesEl.appendChild(loaderBubble);
  scrollToBottom(messagesEl);

  // 5. POST to Ollama
  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [systemMessage, ...chatHistory],
        stream: false,
      }),
    });

    // Remove loader before rendering result
    loaderBubble.remove();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const assistantContent =
      data?.message?.content ?? data?.choices?.[0]?.message?.content ?? '';

    if (assistantContent) {
      // 6a. Append to history and render assistant bubble
      const assistantMessage = { role: 'assistant', content: assistantContent };
      chatHistory = appendMessage(chatHistory, assistantMessage);

      const assistantBubble = createBubble(assistantContent, 'bubble--assistant');
      messagesEl.appendChild(assistantBubble);
    }
  } catch (_err) {
    // Remove loader if it's still attached (e.g. network error before response)
    if (loaderBubble.parentNode) {
      loaderBubble.remove();
    }

    // Render error bubble
    const errorBubble = createBubble(
      'Assistant is temporarily unavailable.',
      'bubble--error',
    );
    messagesEl.appendChild(errorBubble);
  }

  // 7. Scroll to bottom after each update
  scrollToBottom(messagesEl);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Renders the full chat UI into `container` and wires up event handlers.
 * Safe to call once per page load; subsequent calls on the same container
 * are idempotent (the container is cleared and re-rendered).
 *
 * @param {HTMLElement} container - The tab panel element to mount into.
 * @param {string}      uid       - The authenticated resident's Firebase UID (reserved for future use).
 */
export function init(container, uid) { // eslint-disable-line no-unused-vars
  if (!container) return;

  // Reset history on each fresh init
  chatHistory = [];

  // Build the chat UI structure
  container.innerHTML = /* html */ `
    <div class="chatbot-wrapper">
      <div class="chat-messages" id="chat-messages" aria-live="polite" aria-label="Chat history"></div>
      <div class="chat-input-row">
        <input
          type="text"
          class="chat-input"
          id="chat-input"
          placeholder="Ask about ordinances..."
          aria-label="Chat message input"
        />
        <button type="button" class="chat-send-btn" id="chat-send-btn" aria-label="Send message">
          Send
        </button>
      </div>
    </div>
  `;

  const messagesEl = /** @type {HTMLElement} */ (container.querySelector('#chat-messages'));
  const inputEl    = /** @type {HTMLInputElement} */ (container.querySelector('#chat-input'));
  const sendBtn    = /** @type {HTMLButtonElement} */ (container.querySelector('#chat-send-btn'));

  // Wire up send button click
  sendBtn.addEventListener('click', () => handleSend(inputEl, messagesEl));

  // Wire up Enter key on input
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(inputEl, messagesEl);
    }
  });
}
