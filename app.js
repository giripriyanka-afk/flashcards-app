'use strict';

/* ============================================================
   Study with Flashcards
   Deck lives in localStorage; no server, no build step.
   Card shape: { id, question, answer, status: 'new' | 'learning' | 'known' }
   ============================================================ */

const STORAGE_KEY = 'studyFlashcards.deck.v1';
const FILTER_KEY = 'studyFlashcards.filter.v1';

const FILTERS = ['all', 'known', 'unknown'];

/** The whole deck, in display order. */
let deck = [];

/** Id of the card currently being edited inline, or null. */
let editingId = null;

/** Which cards the deck list shows: 'all', 'known', or 'unknown'. */
let activeFilter = 'all';

/* ---------- Review session state ---------- */
let inReview = false;
let queue = [];          // card ids for this session
let queueIndex = 0;
let isFlipped = false;
let sessionCounts = { known: 0, learning: 0 };

/* ---------- Elements ---------- */
const el = (id) => document.getElementById(id);

const deckView = el('deck-view');
const reviewView = el('review-view');
const navDeckBtn = el('nav-deck');
const navReviewBtn = el('nav-review');

const cardForm = el('card-form');
const questionInput = el('question-input');
const answerInput = el('answer-input');
const formError = el('form-error');
const cardList = el('card-list');
const deckEmpty = el('deck-empty');
const deckStats = el('deck-stats');
const resetProgressBtn = el('reset-progress');
const deckFilters = el('deck-filters');

const reviewSetup = el('review-setup');
const reviewSession = el('review-session');
const reviewDone = el('review-done');
const onlyLearningInput = el('only-learning');
const shuffleInput = el('shuffle-cards');
const startReviewBtn = el('start-review');
const reviewSetupNote = el('review-setup-note');
const reviewProgress = el('review-progress');
const exitReviewBtn = el('exit-review');
const flashcardEl = el('flashcard');
const cardQuestion = el('card-question');
const cardAnswer = el('card-answer');
const markKnownBtn = el('mark-known');
const markLearningBtn = el('mark-learning');
const doneSummary = el('done-summary');
const reviewAgainBtn = el('review-again');
const backToDeckBtn = el('back-to-deck');

/* ============================================================
   Storage
   ============================================================ */

function loadDeck() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    deck = Array.isArray(parsed) ? parsed.map(normalizeCard).filter(Boolean) : [];
  } catch (error) {
    console.error('Could not read the saved deck, starting empty.', error);
    deck = [];
  }
}

function saveDeck() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(deck));
  } catch (error) {
    console.error('Could not save the deck.', error);
    showFormError('Your browser blocked saving, so changes may be lost on reload.');
  }
}

function loadFilter() {
  try {
    const saved = localStorage.getItem(FILTER_KEY);
    activeFilter = FILTERS.includes(saved) ? saved : 'all';
  } catch (error) {
    console.error('Could not read the saved filter.', error);
    activeFilter = 'all';
  }
}

function saveFilter() {
  try {
    localStorage.setItem(FILTER_KEY, activeFilter);
  } catch (error) {
    console.error('Could not save the filter.', error);
  }
}

function normalizeCard(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const question = typeof raw.question === 'string' ? raw.question.trim() : '';
  const answer = typeof raw.answer === 'string' ? raw.answer.trim() : '';
  if (!question || !answer) return null;
  const status = ['new', 'learning', 'known'].includes(raw.status) ? raw.status : 'new';
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : makeId(),
    question,
    answer,
    status,
  };
}

function makeId() {
  return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function findCard(id) {
  return deck.find((card) => card.id === id) || null;
}

/* ============================================================
   View switching
   ============================================================ */

function showView(name) {
  const showDeck = name === 'deck';
  deckView.hidden = !showDeck;
  reviewView.hidden = showDeck;
  navDeckBtn.setAttribute('aria-pressed', String(showDeck));
  navReviewBtn.setAttribute('aria-pressed', String(!showDeck));

  if (showDeck) {
    endSession();
    renderDeck();
  } else {
    showReviewSetup();
  }
}

/* ============================================================
   Deck view
   ============================================================ */

function renderDeck() {
  cardList.textContent = '';
  resetProgressBtn.hidden = deck.length === 0;
  deckFilters.hidden = deck.length === 0;
  renderStats();
  renderFilterChips();

  const visible = visibleCards();
  deckEmpty.hidden = visible.length > 0;
  deckEmpty.textContent = emptyMessage();

  visible.forEach((card) => {
    cardList.appendChild(card.id === editingId ? buildEditRow(card) : buildCardRow(card));
  });
}

/** Cards the current filter lets through. 'unknown' means anything not known yet. */
function visibleCards() {
  if (activeFilter === 'known') return deck.filter((card) => card.status === 'known');
  if (activeFilter === 'unknown') return deck.filter((card) => card.status !== 'known');
  return deck;
}

function renderFilterChips() {
  const known = deck.filter((card) => card.status === 'known').length;
  const counts = { all: deck.length, known, unknown: deck.length - known };

  deckFilters.querySelectorAll('button[data-filter]').forEach((chip) => {
    const name = chip.dataset.filter;
    chip.setAttribute('aria-pressed', String(name === activeFilter));
    const count = chip.querySelector('.chip-count');
    if (count) count.textContent = counts[name];
  });
}

function emptyMessage() {
  if (deck.length === 0) return 'No cards yet. Add your first question and answer above.';
  if (activeFilter === 'known') return 'No cards are marked known yet.';
  if (activeFilter === 'unknown') return 'Every card is marked known — nothing left to learn.';
  return '';
}

function setFilter(name) {
  if (!FILTERS.includes(name) || name === activeFilter) return;
  activeFilter = name;
  editingId = null;   // the card being edited may not survive the new filter
  saveFilter();
  renderDeck();
}

function renderStats() {
  if (deck.length === 0) {
    deckStats.textContent = '';
    return;
  }
  const known = deck.filter((card) => card.status === 'known').length;
  const learning = deck.filter((card) => card.status === 'learning').length;
  const fresh = deck.length - known - learning;
  deckStats.textContent =
    `${deck.length} card${deck.length === 1 ? '' : 's'} · ` +
    `${known} known · ${learning} still learning · ${fresh} not reviewed`;
}

function buildCardRow(card) {
  const item = document.createElement('li');
  item.className = 'card-item';
  item.dataset.id = card.id;

  const text = document.createElement('div');
  text.className = 'card-item__text';

  const question = document.createElement('p');
  question.className = 'card-item__q';
  question.textContent = card.question;

  const answer = document.createElement('p');
  answer.className = 'card-item__a';
  answer.textContent = card.answer;

  text.append(question, answer);

  const meta = document.createElement('div');
  meta.className = 'card-item__meta';
  meta.append(
    buildBadge(card.status),
    buildIconButton('Edit', 'edit', card.question),
    buildIconButton('Delete', 'delete', card.question, true)
  );

  item.append(text, meta);
  return item;
}

function buildBadge(status) {
  const labels = { known: 'Known', learning: 'Still learning', new: 'New' };
  const badge = document.createElement('span');
  badge.className = 'badge' + (status === 'new' ? '' : ` badge--${status}`);
  badge.textContent = labels[status];
  return badge;
}

function buildIconButton(label, action, cardQuestionText, isDanger) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-btn' + (isDanger ? ' icon-btn--danger' : '');
  button.dataset.action = action;
  button.textContent = label;
  button.setAttribute('aria-label', `${label} card: ${cardQuestionText}`);
  return button;
}

function buildEditRow(card) {
  const item = document.createElement('li');
  item.className = 'card-item card-item--editing';
  item.dataset.id = card.id;

  const form = document.createElement('form');
  form.dataset.action = 'save';

  form.append(
    buildEditField('Question', 'question', card.question),
    buildEditField('Answer', 'answer', card.answer)
  );

  const actions = document.createElement('div');
  actions.className = 'edit-form__actions';

  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn btn--primary btn--small';
  save.textContent = 'Save';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn--ghost btn--small';
  cancel.dataset.action = 'cancel';
  cancel.textContent = 'Cancel';

  actions.append(save, cancel);
  form.append(actions);
  item.append(form);
  return item;
}

function buildEditField(labelText, name, value) {
  const label = document.createElement('label');
  label.className = 'field';

  const span = document.createElement('span');
  span.className = 'field__label';
  span.textContent = labelText;

  const textarea = document.createElement('textarea');
  textarea.name = name;
  textarea.rows = 2;
  textarea.required = true;
  textarea.value = value;

  label.append(span, textarea);
  return label;
}

/* ---------- Deck actions ---------- */

function addCard(question, answer) {
  deck.unshift({ id: makeId(), question, answer, status: 'new' });

  // A brand new card is never "known", so don't let that filter hide it.
  if (activeFilter === 'known') {
    activeFilter = 'all';
    saveFilter();
  }

  saveDeck();
  renderDeck();
}

function updateCard(id, question, answer) {
  const card = findCard(id);
  if (!card) return;
  card.question = question;
  card.answer = answer;
  saveDeck();
}

function deleteCard(id) {
  deck = deck.filter((card) => card.id !== id);
  saveDeck();
  renderDeck();
}

function showFormError(message) {
  formError.textContent = message;
}

/* ---------- Deck event wiring ---------- */

cardForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const question = questionInput.value.trim();
  const answer = answerInput.value.trim();

  if (!question || !answer) {
    showFormError('Both a question and an answer are needed.');
    return;
  }

  showFormError('');
  addCard(question, answer);
  cardForm.reset();
  questionInput.focus();
});

// Enter submits from either field; Shift+Enter still inserts a real newline.
cardForm.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey) return;
  if (!event.target || event.target.tagName !== 'TEXTAREA') return;

  event.preventDefault();
  if (typeof cardForm.requestSubmit === 'function') {
    cardForm.requestSubmit();
  } else {
    cardForm.dispatchEvent(new Event('submit', { cancelable: true }));
  }
});

cardList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const item = button.closest('[data-id]');
  if (!item) return;
  const id = item.dataset.id;

  if (button.dataset.action === 'edit') {
    editingId = id;
    renderDeck();
    const textarea = cardList.querySelector(`[data-id="${id}"] textarea`);
    if (textarea) textarea.focus();
  } else if (button.dataset.action === 'delete') {
    const card = findCard(id);
    if (card && window.confirm(`Delete this card?\n\n${card.question}`)) {
      if (editingId === id) editingId = null;
      deleteCard(id);
    }
  } else if (button.dataset.action === 'cancel') {
    editingId = null;
    renderDeck();
  }
});

cardList.addEventListener('submit', (event) => {
  const form = event.target;
  if (form.dataset.action !== 'save') return;
  event.preventDefault();

  const item = form.closest('[data-id]');
  if (!item) return;

  const question = form.elements.question.value.trim();
  const answer = form.elements.answer.value.trim();
  if (!question || !answer) {
    window.alert('Both a question and an answer are needed.');
    return;
  }

  updateCard(item.dataset.id, question, answer);
  editingId = null;
  renderDeck();
});

deckFilters.addEventListener('click', (event) => {
  const chip = event.target.closest('button[data-filter]');
  if (chip) setFilter(chip.dataset.filter);
});

resetProgressBtn.addEventListener('click', () => {
  if (deck.length === 0) return;
  if (!window.confirm('Mark every card as not reviewed?')) return;
  deck.forEach((card) => { card.status = 'new'; });
  saveDeck();
  renderDeck();
});

/* ============================================================
   Review mode
   ============================================================ */

function showReviewSetup() {
  endSession();
  reviewSetup.hidden = false;
  reviewSession.hidden = true;
  reviewDone.hidden = true;

  const available = selectableCards().length;
  if (deck.length === 0) {
    reviewSetupNote.textContent = 'Your deck is empty. Add a card first.';
  } else if (available === 0) {
    reviewSetupNote.textContent = 'No cards match that filter — everything is marked known.';
  } else {
    reviewSetupNote.textContent =
      `${available} card${available === 1 ? '' : 's'} ready to review.`;
  }
  startReviewBtn.disabled = available === 0;
}

function selectableCards() {
  return onlyLearningInput.checked
    ? deck.filter((card) => card.status !== 'known')
    : deck.slice();
}

function startReview() {
  const cards = selectableCards();
  if (cards.length === 0) return;

  if (shuffleInput.checked) shuffle(cards);

  queue = cards.map((card) => card.id);
  queueIndex = 0;
  isFlipped = false;
  sessionCounts = { known: 0, learning: 0 };
  inReview = true;

  reviewSetup.hidden = true;
  reviewDone.hidden = true;
  reviewSession.hidden = false;

  renderCurrentCard();
  flashcardEl.focus();
}

function endSession() {
  inReview = false;
  queue = [];
  queueIndex = 0;
  isFlipped = false;
  flashcardEl.classList.remove('is-flipped');
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

function currentCard() {
  return findCard(queue[queueIndex]);
}

function renderCurrentCard() {
  const card = currentCard();
  if (!card) {
    finishSession();
    return;
  }

  isFlipped = false;
  flashcardEl.classList.remove('is-flipped');
  flashcardEl.setAttribute('aria-label', 'Question. Activate to reveal the answer.');
  cardQuestion.textContent = card.question;
  cardAnswer.textContent = card.answer;
  reviewProgress.textContent = `Card ${queueIndex + 1} of ${queue.length}`;
}

function flipCard() {
  if (!inReview) return;
  isFlipped = !isFlipped;
  flashcardEl.classList.toggle('is-flipped', isFlipped);
  flashcardEl.setAttribute(
    'aria-label',
    isFlipped
      ? `Answer: ${cardAnswer.textContent}`
      : 'Question. Activate to reveal the answer.'
  );
}

function markCurrent(status) {
  if (!inReview) return;
  const card = currentCard();
  if (card) {
    card.status = status;
    sessionCounts[status] += 1;
    saveDeck();
  }
  queueIndex += 1;

  if (queueIndex >= queue.length) {
    finishSession();
    return;
  }
  renderCurrentCard();
  flashcardEl.focus();
}

function finishSession() {
  const reviewed = sessionCounts.known + sessionCounts.learning;
  inReview = false;
  reviewSession.hidden = true;
  reviewSetup.hidden = true;
  reviewDone.hidden = false;

  const known = deck.filter((card) => card.status === 'known').length;
  doneSummary.textContent = reviewed === 0
    ? 'No cards were marked this session.'
    : `You knew ${sessionCounts.known} of ${reviewed} card${reviewed === 1 ? '' : 's'}, ` +
      `and marked ${sessionCounts.learning} as still learning.\n` +
      `Deck total: ${known} of ${deck.length} known.`;

  renderDeck();
  reviewAgainBtn.focus();
}

/* ---------- Review event wiring ---------- */

startReviewBtn.addEventListener('click', startReview);
flashcardEl.addEventListener('click', flipCard);
markKnownBtn.addEventListener('click', () => markCurrent('known'));
markLearningBtn.addEventListener('click', () => markCurrent('learning'));
exitReviewBtn.addEventListener('click', showReviewSetup);
reviewAgainBtn.addEventListener('click', () => {
  showReviewSetup();
  startReview();
});
backToDeckBtn.addEventListener('click', () => showView('deck'));
onlyLearningInput.addEventListener('change', showReviewSetup);

navDeckBtn.addEventListener('click', () => showView('deck'));
navReviewBtn.addEventListener('click', () => showView('review'));

/* ---------- Keyboard shortcuts (review only) ---------- */

function isInteractive(node) {
  if (!node || !node.tagName) return false;
  return ['BUTTON', 'TEXTAREA', 'INPUT', 'SELECT', 'A'].includes(node.tagName)
    || node.isContentEditable;
}

document.addEventListener('keydown', (event) => {
  if (!inReview || event.metaKey || event.ctrlKey || event.altKey) return;

  const key = event.key;

  if (key === ' ' || key === 'Spacebar') {
    // A focused button already flips/marks on its own; only step in elsewhere.
    if (isInteractive(event.target)) return;
    event.preventDefault();
    flipCard();
    return;
  }

  if (key === 'Enter' && event.target === flashcardEl) return; // native activation

  if (key === 'k' || key === 'K') {
    event.preventDefault();
    markCurrent('known');
  } else if (key === 'l' || key === 'L') {
    event.preventDefault();
    markCurrent('learning');
  } else if (key === 'Escape') {
    event.preventDefault();
    showReviewSetup();
  }
});

/* ============================================================
   Start
   ============================================================ */

loadDeck();
loadFilter();
showView('deck');
