'use strict';

/* Translation strings. Add a language by adding a key here. */
const I18N = {
  bn: {
    game_title: 'তিন দানা',
    tagline: 'একটি ঐতিহ্যবাহী কৌশলের খেলা',
    nickname_label: 'আপনার নাম লিখুন',
    nickname_placeholder: 'যেমন: অর্জুন',
    enter_lobby: 'লবিতে প্রবেশ করুন',
    lobby_title: 'লবি',
    create_match: 'নতুন খেলা তৈরি করুন',
    mode_standard: 'সাধারণ',
    mode_diagonal: 'শুধু কোণাকুণি',
    waiting_matches: 'অপেক্ষমাণ',
    live_matches: 'চলমান',
    finished_matches: 'শেষ হয়েছে',
    no_matches: 'কোনো খেলা নেই',
    join_seat: 'যোগ দিন',
    watch: 'দেখুন',
    spectators: 'দর্শক',
    private_match: 'ব্যক্তিগত খেলা (পাস কী প্রয়োজন)',
    private_label: 'Private',
    join_private_match_by_id: 'Private join',
    join_private_match_id_placeholder: 'Enter private match ID',
    enter_private_match_passkey: 'Enter private match pass key',
    private_match_help_text: 'এই খেলাগুলি লবিতে দেখাবে, কিন্তু খেলায় যোগদানের জন্য একটি পাস কী প্রয়োজন।',
    private_match_id_tooltip: 'প্রতিটি ব্যক্তিগত ম্যাচ একটি একক আইডি দিয়ে যোগ করুন।',
    private_match_created_key: 'আপনার প্রতিপক্ষকে এই পাস কী দিন: {key}',
    back_to_lobby: '← লবিতে ফিরুন',
    your_turn: 'আপনার পালা',
    global_chat: 'সর্বজনীন চ্যাট',
    chat_help: 'খেলার আগে বা খেলতে খেলতে সবাইকে বার্তা পাঠান',
    chat_placeholder: 'এখানে লিখুন…',
    chat_send: 'পাঠান',
    open_chat: 'চ্যাট খুলুন',
    minimize_chat: 'চ্যাট মিনিমাইজ করুন',
    report: 'রিপোর্ট',
    no_chat_messages: 'কোনো বার্তা নেই',
    opponent_turn: '{name}-এর পালা',
    phase_drop: 'দানা বসানোর পর্ব',
    phase_move: 'দানা চালানোর পর্ব',
    select_bead_hint: 'চালানোর জন্য নিজের একটি দানা বেছে নিন',
    select_destination_hint: 'এবার একটি খালি ঘর বেছে নিন',
    you_win: 'আপনি জিতেছেন!',
    you_lose: 'আপনি হেরেছেন',
    draw: 'অমীমাংসিত',
    opponent_disconnected: 'প্রতিপক্ষের সংযোগ বিচ্ছিন্ন হয়েছে — পুনরায় সংযোগের অপেক্ষা',
    opponent_reconnected: 'প্রতিপক্ষ ফিরে এসেছে',
    reconnecting: 'পুনরায় সংযোগ করা হচ্ছে…',
    leave_match: 'খেলা ছেড়ে দিন',
    request_rematch: 'আবার খেলুন',
    rematch_waiting: 'প্রতিপক্ষের সিদ্ধান্তের অপেক্ষায়',
    rematch_proposed_by: '{name} নতুন খেলার প্রস্তাব দিয়েছেন',
    rematch_accept: 'প্রত্যায়ন করুন',
    rematch_decline: 'প্রত্যাখ্যান করুন',
    confirm_decline_rematch: 'আপনি কি নিশ্চিত যে আপনি পুনরায় খেলার প্রস্তাবটি প্রত্যাখ্যান করতে চান?',
    rematch_declined_by: '{name} প্রস্তাবটি প্রত্যাখ্যান করেছেন',
    spectating: 'আপনি দর্শক হিসেবে দেখছেন',
    refresh_lobby: 'লবি রিফ্রেশ করুন',
    refreshing_lobby: 'রিফ্রেশ করা হচ্ছে...',
    lang_toggle: 'English',
    empty_cell_label: 'খালি ঘর {n}',
    your_bead_label: 'আপনার দানা, ঘর {n}',
    opponent_bead_label: 'প্রতিপক্ষের দানা, ঘর {n}',
    match_over_reason_win: '{winner} জিতেছেন',
    match_over_reason_draw: 'খেলাটি অমীমাংসিত হয়েছে',
    match_over_reason_disconnect: 'সংযোগ বিচ্ছিন্ন হওয়ার কারণে {winner} জিতেছেন',
    match_over_reason_no_moves: 'কোনো বৈধ চাল না থাকায় {winner} জিতেছেন',
    you_label: 'আপনি',
    connection_lost: 'সংযোগ বিচ্ছিন্ন — পুনরায় চেষ্টা করা হচ্ছে',
    server_rejected: 'ঐ চালটি গ্রহণযোগ্য নয়',
  },
  en: {
    game_title: 'Tin Dana',
    tagline: 'A traditional Bengali strategy game',
    nickname_label: 'Enter your name',
    nickname_placeholder: 'e.g. Arjun',
    enter_lobby: 'Enter lobby',
    lobby_title: 'Lobby',
    create_match: 'Create a new match',
    mode_standard: 'Standard',
    mode_diagonal: 'Diagonal-only',
    waiting_matches: 'Waiting',
    live_matches: 'Live',
    finished_matches: 'Finished',
    no_matches: 'No matches',
    join_seat: 'Join',
    watch: 'Watch',
    spectators: 'watching',
    private_match: 'Private match (pass key required)',
    private_label: 'Private',
    join_private_match_by_id: 'Private join',
    join_private_match_id_placeholder: 'Enter private match ID',
    enter_private_match_passkey: 'Enter private match pass key',
    private_match_help_text: 'Private matches are visible in the lobby, but require a pass key to join.',
    private_match_id_tooltip: 'Enter a private match ID shared by the host.',
    private_match_created_key: 'Share this pass key with your opponent: {key}',
    back_to_lobby: '← Back to lobby',
    your_turn: 'Your turn',
    global_chat: 'Global chat',
    chat_help: 'Send messages to everyone before or during play',
    chat_placeholder: 'Type a message…',
    chat_send: 'Send',
    open_chat: 'Open chat',
    minimize_chat: 'Minimize chat',
    report: 'Report',
    no_chat_messages: 'No messages yet',
    opponent_turn: "{name}'s turn",
    phase_drop: 'Placement phase',
    phase_move: 'Movement phase',
    select_bead_hint: 'Select one of your beads to move',
    select_destination_hint: 'Now choose an empty point',
    you_win: 'You win!',
    you_lose: 'You lose',
    draw: 'Draw',
    opponent_disconnected: 'Opponent disconnected — waiting for reconnect',
    opponent_reconnected: 'Opponent reconnected',
    reconnecting: 'Reconnecting…',
    leave_match: 'Leave match',
    request_rematch: 'Request rematch',
    rematch_waiting: 'Waiting for opponent to accept',
    rematch_proposed_by: '{name} has proposed a rematch',
    rematch_accept: 'Accept',
    rematch_decline: 'Decline',
    confirm_decline_rematch: 'Are you sure you want to decline the rematch?',
    rematch_declined_by: '{name} declined the rematch',
    spectating: 'You are spectating',
    refresh_lobby: 'Refresh lobby',
    refreshing_lobby: 'Refreshing...',
    lang_toggle: 'বাংলা',
    empty_cell_label: 'Empty point {n}',
    your_bead_label: 'Your bead, point {n}',
    opponent_bead_label: "Opponent's bead, point {n}",
    match_over_reason_win: '{winner} won',
    match_over_reason_draw: 'The match was a draw',
    match_over_reason_disconnect: '{winner} won by disconnect',
    match_over_reason_no_moves: '{winner} won — no legal moves left for the opponent',
    you_label: 'You',
    connection_lost: 'Connection lost — reconnecting',
    server_rejected: 'That move was rejected',
    create_match_failed: 'Could not create a new match.',
    already_have_active_match: 'You already have an active match.',
    private_match: 'Private match (hidden from lobby)',
  },
};

function t(lang, key, vars) {
  const dict = I18N[lang] || I18N.en;
  let str = dict[key] || I18N.en[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(`{${k}}`, v);
    }
  }
  return str;
}

function tr(key, vars) {
  const lang = document.body.dataset.lang || document.documentElement.lang || 'bn';
  return t(lang, key, vars);
}

function applyLangToChrome(lang = document.body.dataset.lang || 'bn') {
  document.documentElement.lang = lang;
  document.body.dataset.lang = lang;

  const title = document.getElementById('app-title');
  if (title) title.textContent = t(lang, 'game_title');

  const subtitle = document.getElementById('app-tagline');
  if (subtitle) subtitle.textContent = t(lang, 'tagline');

  const toggle = document.getElementById('lang-toggle');
  if (toggle) toggle.textContent = t(lang, 'lang_toggle');
}
