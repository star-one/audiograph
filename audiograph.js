/*!
 * AudioGraph - turn a line graph into sound.
 *
 * Copyright (c) [YOUR NAME]. Released under the MIT licence (see LICENSE).
 *
 * WHAT IT DOES
 * ------------
 * Plays a line graph as a continuous tone whose pitch follows the line, like a theremin or the
 * ring of an Ondes Martenot. A table of numbers is a reasonable accommodation for someone who
 * can't see a graph, but it isn't an *alternative*: the point of a graph is to perceive the
 * shape of the data. This gives that shape a sound.
 *
 *   - One series, or two compared at once (a sine tone and a sawtooth tone, spread slightly
 *     left and right). On a line graph the two tones glide together; on a bar or pie chart each
 *     bar or slice gives each series its own turn, one after the other, rather than a chord.
 *   - The lowest value plays G below middle C, the median plays the G above middle C, and the
 *     highest value plays the G above the C above middle C. (Each series is scaled on its own.)
 *   - A short "ting" sounds each time a series crosses its median: higher going up, lower
 *     going down.
 *   - The first time Play is pressed, the title and a description are read aloud with each word
 *     highlighted, then the graph plays. Labels (months, years, names...) are spoken as they
 *     change.
 *   - Play, Pause, Stop and a speed control. A small reverb.
 *   - Works on iPhone and iPad (see "iOS" below).
 *   - Line graphs, bar charts and pie charts. A line is played as one gliding tone. Bars and
 *     slices are played as separate notes, one after another, with the name of each spoken.
 *
 * FILES
 * -----
 * This file is the engine: it reads its settings from config.js and does the work. You
 * shouldn't normally need to open it, and are not expected to edit it, unless you are forking
 * AudioGraph for deeper customisation. If you're looking for the settings, the wording on the
 * controls, or the sentences AudioGraph speaks, see config.js instead - that is the file meant
 * to be edited.
 *
 * BASIC USE
 * ---------
 *   <link rel="stylesheet" href="audiograph.css">
 *   <script src="config.js"></script>
 *   <script src="audiograph.js"></script>
 *
 *   var graph = AudioGraph.add(document.getElementById('controls'), {
 *     id: 'rainfall',                                   // unique on the page
 *     title: 'Monthly rainfall',                        // announced before playing
 *     labels: ['January', 'February', 'March'],         // one per value; spoken when they change
 *     series: [{ name: 'Rainfall', unit: 'millimetres', values: [80, 62, 55] }],
 *     medianLine: true,                                 // say the chart draws the median (see README)
 *     onPosition: function (row) { ... }                // move your marker (see README)
 *   });
 *
 * See README.md for the full list of options.
 *
 * NO DEPENDENCIES. It uses the Web Audio API for the sound and (optionally) the Web Speech API
 * for the spoken parts; without speech it still plays.
 *
 * HOW THE TONES ARE MADE (for the curious)
 * ----------------------------------------
 * Each series' pitch and volume are written into a two-channel "control" buffer. A buffer
 * source plays that buffer into an oscillator's frequency and volume controls. Speed is then
 * just the buffer sources' playbackRate, so it can change smoothly mid-play, and pausing simply
 * freezes the audio clock.
 */
(function (global) {
  'use strict';

  // SETTINGS. All of AudioGraph's settings, including the sentences it speaks, live in config.js, loaded
  // before this file, as window.AudioGraphConfig. AudioGraph.config (see the public API, at the bottom of
  // this file) is the very same object, so AudioGraph.config.reverbLevel = 0 and editing config.js reach
  // the same place.
  var CONFIG = global.AudioGraphConfig;
  if (!CONFIG) {
    throw new Error('AudioGraph: config.js must be loaded before audiograph.js.');
  }

  /* =========================================================================================
     STATE
     ========================================================================================= */
  var graphs = {};        // id -> everything we know about that graph
  var audioContext = null;
  var bus = null;         // shared mixer + reverb
  var impulse = null;     // reverb impulse response
  var active = null;      // the one graph currently introducing, playing or paused
  var timer = null;
  var introduced = {};    // id -> true once its spoken introduction has been started
  var charsPerSecond = CONFIG.speechCharsPerSecond;
  var cueUtterance = null; // kept referenced so the browser doesn't discard it mid-speech
  var silentAudio = null;  // iPhone/iPad: a silent looping sound that keeps the audio session in "playback" mode
  var releaseTimer = null;
  var counter = 0;

  var numberFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
  var numberFormat1 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });   // pie chart percentages
  function fmt(n) { return numberFormat.format(n); }
  function fmt1(n) { return numberFormat1.format(n); }
  function midiToHz(note) { return 440 * Math.pow(2, (note - 69) / 12); }
  function voiceSettings(v) { return CONFIG.voices[v] || CONFIG.voices[0]; }
  function fill(template, values) {
    return String(template).replace(/\{(\w+)\}/g, function (all, key) { return values[key] !== undefined ? values[key] : all; });
  }

  /* =========================================================================================
     MATHS
     ========================================================================================= */

  /* Smooth curve through the data points.
     Monotone cubic interpolation (Fritsch-Carlson): smooth like a curved chart line, but never
     overshoots the lowest or highest value, so the pitch never leaves its range. */
  function monotoneInterpolator(pts) {
    var n = pts.length, i, k = 0;
    var x = pts.map(function (p) { return p.x; });
    var y = pts.map(function (p) { return p.y; });
    var d = [], m = [];
    for (i = 0; i < n - 1; i++) { d[i] = (y[i + 1] - y[i]) / (x[i + 1] - x[i]); }
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for (i = 1; i < n - 1; i++) { m[i] = (d[i - 1] * d[i] <= 0) ? 0 : (d[i - 1] + d[i]) / 2; }
    for (i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      var a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) {
        var tau = 3 / Math.sqrt(s);
        m[i] = tau * a * d[i];
        m[i + 1] = tau * b * d[i];
      }
    }
    return function (q) {
      if (q <= x[0]) { return y[0]; }
      if (q >= x[n - 1]) { return y[n - 1]; }
      if (q < x[k]) { k = 0; }
      while (q > x[k + 1]) { k++; }
      var h = x[k + 1] - x[k], t = (q - x[k]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * y[k] + (t3 - 2 * t2 + t) * h * m[k] +
             (-2 * t3 + 3 * t2) * y[k + 1] + (t3 - t2) * h * m[k + 1];
    };
  }

  // The note (a MIDI number) for a value: lowest -> low note, median -> centre note, highest -> high note.
  // Linear in semitones on each side of the median. If the median equals the lowest (or highest) value
  // that side has no room, so a value on it sits on the centre note.
  function noteFor(value, lo, med, hi) {
    var centre = (CONFIG.lowNote + CONFIG.highNote) / 2;   // MIDI 67 = G above middle C
    if (value <= med) { return (med > lo) ? CONFIG.lowNote + (value - lo) / (med - lo) * (centre - CONFIG.lowNote) : centre; }
    return centre + (value - med) / (hi - med) * (CONFIG.highNote - centre);
  }

  // Statistical median of the numbers in an array (null, undefined and NaN are ignored). null if there are none.
  function median(values) {
    var sorted = [];
    for (var i = 0; i < values.length; i++) {
      var n = toNumber(values[i]);
      if (n !== null) { sorted.push(n); }
    }
    if (!sorted.length) { return null; }
    sorted.sort(function (a, b) { return a - b; });
    var middle = Math.floor(sorted.length / 2);
    return (sorted.length % 2) ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function toNumber(raw) {
    if (raw === null || raw === undefined || raw === '') { return null; }
    var n = Number(raw);
    return isFinite(n) ? n : null;
  }

  // Where (0 to 1 through the graph) the smooth curve crosses the median, and which way (up: true).
  // Only real crossings count: touching the median and turning back does not.
  function findCrossings(valueAt, med) {
    var steps = 4000, crossings = [];
    function side(v) { return v > med ? 1 : (v < med ? -1 : 0); }
    var x0 = 0, v0 = valueAt(0), lastSide = side(v0);
    for (var i = 1; i <= steps; i++) {
      var x1 = i / steps, v1 = valueAt(x1), s = side(v1);
      if (s !== 0) {
        if (lastSide !== 0 && s !== lastSide) {
          var x = (v1 === v0) ? x1 : x0 + (med - v0) / (v1 - v0) * (x1 - x0);
          crossings.push({ x: Math.min(x1, Math.max(x0, x)), up: s > 0 });
        }
        lastSide = s;
      }
      x0 = x1; v0 = v1;
    }
    return crossings;
  }

  /* =========================================================================================
     THE CONTROLS (built by add(), so you only need an empty element to put them in)
     ========================================================================================= */
  function make(tag, className, attributes) {
    var element = document.createElement(tag);
    if (className) { element.className = className; }
    Object.keys(attributes || {}).forEach(function (name) { element.setAttribute(name, attributes[name]); });
    return element;
  }

  function buildControls(g) {
    var text = CONFIG.text, names = CONFIG.classNames;
    var safe = g.id.replace(/[^A-Za-z0-9_-]/g, '-');
    var vars = { title: g.title };
    function button(action, primary) {
      var b = make('button', 'audiograph-button' + (primary ? ' audiograph-button-primary ' + (names.primaryButton || '') : ' ' + (names.button || '')),
        { type: 'button', 'aria-disabled': 'true', 'aria-label': fill(text[action + 'Label'], vars) });
      b.textContent = text[action];
      return b;
    }

    // The three buttons. Only Play is visible until it is first pressed.
    // aria-disabled (not "disabled") is used so a button keeps keyboard focus when it becomes unavailable.
    var play = button('play', true), pause = button('pause', false), stop = button('stop', false);
    pause.hidden = true;
    stop.hidden = true;
    var buttons = make('div', 'audiograph-buttons');
    buttons.appendChild(play); buttons.appendChild(pause); buttons.appendChild(stop);

    var status = make('p', 'audiograph-status', { id: 'audiograph-' + safe + '-status' });   // not a live region: it would talk over the speech

    // Hidden until Play is first pressed: the description (which is also read aloud) and the speed control
    var desc = make('p', 'audiograph-desc', { id: 'audiograph-' + safe + '-desc' });
    var speedLabel = make('label', '', { 'for': 'audiograph-' + safe + '-speed' });
    speedLabel.textContent = text.speed;
    var speedSelect = make('select', 'audiograph-select ' + (names.select || ''),
      { id: 'audiograph-' + safe + '-speed', 'aria-label': fill(text.speedLabel, vars) });
    g.speedOptions = [];
    CONFIG.speeds.forEach(function (s) {
      var option = document.createElement('option');
      g.speedOptions.push(option);
      option.value = String(s.value);
      option.textContent = fill(text.speedOption, { name: s.name, seconds: fmt(CONFIG.baseDurationSeconds / s.value) });
      if (s.value === 1) { option.selected = true; }
      speedSelect.appendChild(option);
    });
    var speedField = make('div');
    speedField.appendChild(speedLabel); speedField.appendChild(speedSelect);
    var options = make('div', 'audiograph-options');
    options.appendChild(speedField);
    var details = make('div', 'audiograph-details');
    details.hidden = true;
    details.appendChild(desc); details.appendChild(options);

    var group = make('div', 'audiograph', { role: 'group', 'aria-label': fill(text.groupLabel, vars) });
    group.appendChild(buttons); group.appendChild(status); group.appendChild(details);
    g.container.appendChild(group);

    g.group = group; g.details = details; g.desc = desc; g.status = status; g.speedSelect = speedSelect;
    g.buttons = { play: play, pause: pause, stop: stop };

    function onPress(action, run) {
      g.buttons[action].addEventListener('click', function () {
        if (g.buttons[action].getAttribute('aria-disabled') !== 'true') { run(g.id); }
      });
    }
    onPress('play', play_); onPress('pause', pause_); onPress('stop', function () { stopIfActive(g.id); });
    speedSelect.addEventListener('change', function () { applySpeed(g.id); });
  }

  function setEnabled(button, enabled) { button.setAttribute('aria-disabled', enabled ? 'false' : 'true'); }

  // state: 'stopped', 'introducing' (reading the description), 'playing' or 'paused'
  function setState(id, state, message) {
    var g = graphs[id];
    if (!g) { return; }
    g.state = state;
    setEnabled(g.buttons.play, state === 'stopped' || state === 'paused');
    setEnabled(g.buttons.pause, state === 'playing');
    setEnabled(g.buttons.stop, state !== 'stopped');
    g.status.textContent = message || '';
    if (state === 'stopped' || state === 'introducing') { report(g, null); }   // hide the marker
  }

  // Tell the page where we are. A failure in your own function must never stop the sound.
  function report(g, row) {
    if (typeof g.options.onPosition !== 'function') { return; }
    try { g.options.onPosition(row); } catch (e) { if (global.console && console.error) { console.error('AudioGraph: onPosition failed', e); } }
  }

  // The extra controls stay hidden until the first press of Play
  function revealPanel(g) {
    if (g.group.classList.contains('is-open')) { return; }
    g.group.classList.add('is-open');
    g.details.hidden = false;
    g.buttons.pause.hidden = false;
    g.buttons.stop.hidden = false;
  }

  // Says why the graph can't be played, and ties the reason to the Play button for screen readers
  function markUnavailable(g, message) {
    g.available = false;
    g.status.textContent = message;
    g.buttons.play.setAttribute('aria-describedby', g.status.id);
    setEnabled(g.buttons.play, false);
    g.speedSelect.disabled = true;
  }

  /* =========================================================================================
     SPEECH
     ========================================================================================= */
  function speechAvailable() {
    return !!(global.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined');
  }

  function makeUtterance(text, rate, volume) {
    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = CONFIG.speechLang;
    utterance.rate = rate;
    utterance.volume = volume;
    return utterance;
  }

  function cancelSpeech() {
    var synth = global.speechSynthesis;
    if (synth && (synth.speaking || synth.pending)) { synth.cancel(); }
  }

  function estimateSeconds(text, rate) { return text.length / (charsPerSecond * rate); }

  // Works out which cues can be spoken with a lead - starting early enough that the word finishes right as
  // the tone arrives at that point, rather than starting there and trailing behind it - skipping a cue only
  // when there is no room for it at all, rather than ever letting speech fall behind and stay behind.
  // items: [{ x, arrival, label }], arrival in seconds at normal (1x) speed. gapSeconds: silence left after
  // one cue before the next may start.
  function scheduleCues(items, gapSeconds) {
    var out = [], freeFrom = 0;
    items.forEach(function (item) {
      if (freeFrom > item.arrival) { return; }   // no room at all: skip this one rather than announce it late
      var estimate = estimateSeconds(item.label, CONFIG.speechRate);
      var start = Math.max(item.arrival - estimate, freeFrom);
      out.push({ x: item.x, label: item.label, leadSeconds: item.arrival - start });
      freeFrom = start + estimate + gapSeconds;
    });
    return out;
  }

  // A label spoken while the graph plays. It joins the queue, so it is never cut off by the next one.
  // On a line graph, if we are already behind we skip a label rather than fall further behind. For bars and
  // slices every name matters, so `force` says them all.
  function speakCue(text, rate, force) {
    if (!speechAvailable()) { return; }
    var synth = global.speechSynthesis;
    if (!force && synth.speaking && synth.pending) { return; }
    cueUtterance = makeUtterance(text, rate || CONFIG.speechRate, CONFIG.speechVolume);
    synth.speak(cueUtterance);
  }

  // Which labels to say.
  // Bars and slices: every one, at the start of its note (worked out in prepareDiscrete).
  // Line graphs: the first, then each time the label changes. Each is scheduled with scheduleCues() (above)
  // so that, wherever there is room, it finishes right as the graph reaches that point.
  function buildCues(g, speed) {
    if (g.options.speakLabels === false) { return []; }
    if (g.type !== 'line') { return g.cues; }
    var span = g.lastIndex - g.firstIndex;
    var secondsPerRow = g.duration / speed / span;
    var items = [], previousLabel = null;
    for (var row = g.firstIndex; row <= g.lastIndex; row++) {
      var label = g.rowLabels[row];
      if (label === previousLabel) { continue; }
      previousLabel = label;
      if (!label) { continue; }
      items.push({ x: (row - g.firstIndex) / span, arrival: (row - g.firstIndex) * secondsPerRow, label: label });
    }
    return scheduleCues(items, CONFIG.cueGapSeconds);
  }

  function firstUnspokenCue(session) {
    var i = 0;
    while (i < session.cues.length && session.cues[i].x <= session.lastSpokenX + 1e-6) { i++; }
    return i;
  }

  /* ---- Spoken introduction, with each word highlighted as it is said ---- */
  function clearHighlight(g) {
    if (g.highlighted) { g.highlighted.classList.remove('is-current'); g.highlighted = null; }
  }

  function highlightWord(g, sentenceIndex, wordIndex) {
    var word = g.sentences[sentenceIndex].words[wordIndex];
    if (!word) { return; }
    clearHighlight(g);
    word.el.classList.add('is-current');
    g.highlighted = word.el;
  }

  function wordIndexAt(sentence, charIndex) {
    var found = 0;
    for (var i = 0; i < sentence.words.length; i++) {
      if (sentence.words[i].start <= charIndex) { found = i; } else { break; }
    }
    return found;
  }

  // Fallback for voices that don't report word positions: spread the words over the estimated time
  function estimateWordTimes(sentence, totalSeconds) {
    var weights = sentence.words.map(function (word) {
      var text = word.el.textContent;
      return text.length + 1 + (/\.$/.test(text) ? 5 : (/[,:;]$/.test(text) ? 3 : 0));
    });
    var sum = weights.reduce(function (a, b) { return a + b; }, 0);
    var times = [], before = 0;
    weights.forEach(function (w) { times.push(before / sum * totalSeconds * 1000); before += w; });
    return times;
  }

  function runCleanups(session) {
    (session.cleanups || []).forEach(function (fn) { fn(); });
    session.cleanups = [];
  }

  function finishIntro(g, session, cancelRemainingSpeech) {
    if (session.introDone) { return; }
    session.introDone = true;
    clearTimeout(session.watchdog);
    runCleanups(session);
    clearHighlight(g);
    if (cancelRemainingSpeech) { cancelSpeech(); }
    if (active === session) { beginTone(g, session); }
  }

  function makeSentenceUtterance(g, session, index, isLast) {
    var sentence = g.sentences[index];
    var utterance = makeUtterance(sentence.text, CONFIG.introSpeechRate, CONFIG.introSpeechVolume);
    var startedAt = 0, boundarySeen = false, fallbackTimer = null, wordTimers = [];

    function live() { return active === session && !session.introDone; }
    function stopEstimating() {
      clearTimeout(fallbackTimer);
      wordTimers.forEach(clearTimeout);
      wordTimers = [];
    }
    session.cleanups.push(stopEstimating);

    utterance.onstart = function () {
      if (!live()) { return; }
      startedAt = performance.now();
      highlightWord(g, index, 0);
      fallbackTimer = setTimeout(function () {
        if (!live() || boundarySeen) { return; }
        var times = estimateWordTimes(sentence, estimateSeconds(sentence.text, CONFIG.introSpeechRate));
        var elapsed = performance.now() - startedAt;
        times.forEach(function (ms, w) {
          if (ms <= elapsed) { highlightWord(g, index, w); }
          else {
            wordTimers.push(setTimeout(function () {
              if (live() && !boundarySeen) { highlightWord(g, index, w); }
            }, ms - elapsed));
          }
        });
      }, CONFIG.highlightFallbackDelayMs);
    };
    utterance.onboundary = function (event) {
      if (!live()) { return; }
      if (event.name && event.name !== 'word') { return; }
      boundarySeen = true;
      stopEstimating();
      highlightWord(g, index, wordIndexAt(sentence, event.charIndex));
    };
    utterance.onend = function () {
      stopEstimating();
      if (!live()) { return; }
      if (startedAt) {                                  // learn how fast this voice really speaks
        var seconds = (performance.now() - startedAt) / 1000;
        if (seconds > 0.3) {
          var measured = sentence.text.length / seconds / CONFIG.introSpeechRate;
          charsPerSecond = Math.min(30, Math.max(6, 0.5 * charsPerSecond + 0.5 * measured));
        }
      }
      if (isLast) { finishIntro(g, session, false); }
    };
    utterance.onerror = function (event) {
      stopEstimating();
      if (!live()) { return; }
      if (event && (event.error === 'canceled' || event.error === 'interrupted')) { return; }
      finishIntro(g, session, true);                     // speech isn't working: go straight to the graph
    };
    return utterance;
  }

  function startIntro(g, session) {
    var synth = global.speechSynthesis;
    var estimate = 0;
    session.introDone = false;
    session.cleanups = [];
    session.utterances = [];                            // keep references so they aren't discarded mid-speech
    if (g.title) {
      var titleUtterance = makeUtterance(g.title, CONFIG.introSpeechRate, CONFIG.introSpeechVolume);
      titleUtterance.onerror = function (event) {
        if (active !== session || session.introDone) { return; }
        if (event && (event.error === 'canceled' || event.error === 'interrupted')) { return; }
        finishIntro(g, session, true);                   // speech isn't working: go straight to the graph
      };
      session.utterances.push(titleUtterance);
      estimate += estimateSeconds(g.title, CONFIG.introSpeechRate);
    }
    g.sentences.forEach(function (sentence, i) {
      session.utterances.push(makeSentenceUtterance(g, session, i, i === g.sentences.length - 1));
      estimate += estimateSeconds(sentence.text, CONFIG.introSpeechRate);
    });
    // Safety net in case the browser never reports that speech has finished
    session.watchdog = setTimeout(function () { finishIntro(g, session, true); }, (estimate * 2 + 5) * 1000);
    session.utterances.forEach(function (utterance) { synth.speak(utterance); });
  }

  /* =========================================================================================
     THE DESCRIPTION
     This is the text that is shown, and read aloud the first time Play is pressed. It is English.
     To translate it, edit the sentences below (and AudioGraph.config.text for the controls).
     ========================================================================================= */
  function describe(g, voices) {
    var o = g.options, series = o.series, D = CONFIG.descriptions;
    var line = g.type === 'line', pie = g.type === 'pie';
    var first = g.rowLabels[g.firstIndex], last = g.rowLabels[g.lastIndex];
    var span = (first === last) ? 'for ' + first : 'from ' + first + ' to ' + last;
    var seconds = Math.round(g.duration);
    var preposition = o.labelPreposition || (line ? 'in' : 'for');   // "in January", "for Cycle", "under Attlee"
    var medianLine = o.medianLine === true;
    function amount(value, s) { return fmt(value) + (s.unit ? ' ' + s.unit : ''); }
    function at(label) { return ', ' + preposition + ' ' + label; }
    var anyCrossing = voices.some(function (v) { return v.crossings.length > 0; });

    if (voices.length === 1) {
      var v = voices[0], s = series[0], texts;

      if (pie) {                                          // values here are shares of the whole, in percent
        texts = [fill(D.pieIntro, { span: span, seconds: seconds })];
        texts.push(g.speakValues ? D.pieEachNoteWithShare : D.pieEachNoteNameOnly);
        if (v.range === 0) {
          texts.push(fill(D.pieConstant, { value: fmt(v.lo.y) }));
          return texts;
        }
        texts.push(fill(D.pieSmallest, { label: v.lo.label, value: fmt1(v.lo.y) }));
        texts.push(fill(D.pieMedian, { value: fmt1(v.med) }));
        texts.push(fill(D.pieLargest, { label: v.hi.label, value: fmt1(v.hi.y) }));
        if (anyCrossing) { texts.push(D.pieTing); }
        return texts;
      }

      if (line) {
        texts = [fill(D.lineIntro, { span: span, seconds: seconds })];
      } else {
        texts = [fill(D.barIntro, { span: span, seconds: seconds })];
        texts.push(g.speakValues ? D.barEachNoteWithValue : D.barEachNoteNameOnly);
      }
      if (v.range === 0) {
        texts.push(fill(line ? D.lineConstant : D.barConstant, { value: amount(v.lo.y, s) }));
        return texts;
      }
      if (s.name) { texts.push(fill(D.singleSubject, { name: s.name })); }
      texts.push(fill(D.singleLowest, { value: amount(v.lo.y, s), at: at(v.lo.label) }));
      texts.push(fill(D.singleMedian, { value: amount(v.med, s) }));
      texts.push(fill(D.singleHighest, { value: amount(v.hi.y, s), at: at(v.hi.label) }));
      if (medianLine) { texts.push(D.medianLineNote); }
      if (anyCrossing) { texts.push(line ? D.lineTing : D.barTing); }
      return texts;
    }

    function summary(voice, s, which) {
      if (voice.range === 0) { return fill(D.compareSummaryConstant, { which: which, value: amount(voice.lo.y, s) }); }
      return fill(D.compareSummary, {
        which: which, lowest: amount(voice.lo.y, s), lowAt: at(voice.lo.label),
        median: amount(voice.med, s), highest: amount(voice.hi.y, s), highAt: at(voice.hi.label)
      });
    }
    function axis(s) { return s.axis ? ', on the ' + s.axis + ' axis,' : ''; }
    var out = [fill(line ? D.compareIntroLine : D.compareIntroBar, { name1: series[0].name, name2: series[1].name, span: span, seconds: seconds })];
    if (!line) { out.push(g.speakValues ? D.compareEachBarTurnWithValues : D.compareEachBarTurnNameOnly); }
    out.push(fill(D.compareFirstVoice, { axis: axis(series[0]) }));
    out.push(fill(D.compareSecondVoice, { axis: axis(series[1]) }));
    out.push(summary(voices[0], series[0], 'first'));
    out.push(summary(voices[1], series[1], 'second'));
    if (medianLine) { out.push(D.compareMedianLine); }
    if (anyCrossing) {
      out.push(line ? D.compareTingLine : D.compareTingBar);
      out.push(D.compareTimbreNote);
    }
    return out;
  }

  // Put the description on the page, one <span> per word so each can be highlighted as it is read
  function renderDescription(g, texts) {
    var sentences = [];
    g.desc.textContent = '';
    texts.forEach(function (text, si) {
      var words = text.split(/\s+/);
      var entry = { text: words.join(' '), words: [] }, offset = 0;
      words.forEach(function (word, wi) {
        var span = document.createElement('span');
        span.className = 'audiograph-word';
        span.textContent = word;
        g.desc.appendChild(span);
        if (wi < words.length - 1 || si < texts.length - 1) { g.desc.appendChild(document.createTextNode(' ')); }
        entry.words.push({ start: offset, end: offset + word.length, el: span });
        offset += word.length + 1;
      });
      sentences.push(entry);
    });
    g.sentences = sentences;
  }

  /* =========================================================================================
     PREPARING THE DATA: works out the pitches, the crossings and the description
     ========================================================================================= */
  // Each speed option says how long the graph takes at that speed, which is only known once the data is
  function updateSpeedLabels(g) {
    CONFIG.speeds.forEach(function (speed, i) {
      g.speedOptions[i].textContent = fill(CONFIG.text.speedOption, { name: speed.name, seconds: fmt(g.duration / speed.value) });
    });
  }

  function prepare(g) {
    var o = g.options, text = CONFIG.text;
    g.voices = []; g.sentences = []; g.cues = []; g.available = false;
    clearHighlight(g);
    g.buttons.play.removeAttribute('aria-describedby');
    g.status.textContent = '';

    if (!(global.AudioContext || global.webkitAudioContext)) { markUnavailable(g, text.unsupported); return; }

    var rowCount = o.series[0].values.length;
    g.rowCount = rowCount;
    g.rowLabels = [];
    for (var i = 0; i < rowCount; i++) { g.rowLabels.push(String(o.labels ? o.labels[i] : i + 1)); }

    var allValues = o.series.map(function (s) { return s.values.map(toNumber); });     // null = missing
    var tooLittle = allValues.some(function (vals) { return vals.filter(function (v) { return v !== null; }).length < 2; });
    if (tooLittle) {
      markUnavailable(g, o.series.length > 1 ? text.notEnoughDataCompare : text.notEnoughData);
      return;
    }

    if (!(g.type === 'line' ? prepareLine(g, allValues) : prepareDiscrete(g, allValues))) { return; }

    renderDescription(g, describe(g, g.voices));
    updateSpeedLabels(g);
    g.speedSelect.disabled = false;
    g.available = true;
    setState(g.id, 'stopped', '');
  }

  // LINE GRAPHS: one continuous tone per series, gliding along a smooth curve through the values.
  // How long a line graph needs at normal speed: usually CONFIG.baseDurationSeconds, but if the labels are
  // spoken and some are long or close together, that isn't enough time to say each one without it trailing
  // behind the tone - so this predicts the longest a label can take, and stretches the graph just enough to
  // fit it, leaving every graph with short or infrequent labels running at the normal length.
  function computeLineDuration(g) {
    if (g.options.speakLabels === false) { return CONFIG.baseDurationSeconds; }
    var span = g.lastIndex - g.firstIndex;
    if (span <= 0) { return CONFIG.baseDurationSeconds; }
    var rows = [], labels = [], previousLabel = null;
    for (var row = g.firstIndex; row <= g.lastIndex; row++) {
      var label = g.rowLabels[row];
      if (label === previousLabel) { continue; }
      previousLabel = label;
      if (!label) { continue; }
      rows.push(row); labels.push(label);
    }
    var maxRatio = 0;
    for (var j = 1; j < rows.length; j++) {
      var required = estimateSeconds(labels[j], CONFIG.speechRate) + CONFIG.cueGapSeconds;
      maxRatio = Math.max(maxRatio, required / (rows[j] - rows[j - 1]));
    }
    return Math.max(CONFIG.baseDurationSeconds, maxRatio * span);
  }

  function prepareLine(g, allValues) {
    var o = g.options;
    var allPoints = allValues.map(function (vals) {
      var points = [];
      for (var r = 0; r < g.rowCount; r++) {
        if (vals[r] !== null) { points.push({ index: r, y: vals[r], label: g.rowLabels[r] }); }
      }
      return points;
    });

    // All voices share one timeline: from the first row any series has data, to the last.
    // Time runs evenly by row, so gaps in the data keep their proper length.
    g.firstIndex = Math.min.apply(null, allPoints.map(function (points) { return points[0].index; }));
    g.lastIndex = Math.max.apply(null, allPoints.map(function (points) { return points[points.length - 1].index; }));
    g.duration = computeLineDuration(g);
    g.rowAt = function (progress) { return g.firstIndex + progress * (g.lastIndex - g.firstIndex); };   // what onPosition reports

    g.voices = allPoints.map(function (points) {
      points.forEach(function (p) { p.x = (p.index - g.firstIndex) / (g.lastIndex - g.firstIndex); });
      var lo = points[0], hi = points[0];
      points.forEach(function (p) {
        if (p.y < lo.y) { lo = p; }
        if (p.y > hi.y) { hi = p; }
      });
      var med = median(points.map(function (p) { return p.y; }));
      var valueAt = monotoneInterpolator(points);
      return {
        lo: lo, hi: hi, med: med, range: hi.y - lo.y,
        pitchAt: function (progress) { return midiToHz(noteFor(valueAt(progress), lo.y, med, hi.y)); },
        crossings: o.tings === false ? [] : findCrossings(valueAt, med),
        spanStart: points[0].x,                     // a series is silent outside the rows it has data for
        spanEnd: points[points.length - 1].x,
        buffer: null                                // control buffer, built the first time it is played
      };
    });
    return true;
  }

  // BAR CHARTS AND PIE CHARTS: one separate note per bar or slice, in order, with its name spoken.
  // A pie's notes are made from each slice's share of the whole.
  function prepareDiscrete(g, allValues) {
    var o = g.options, rows = g.rowCount, pie = g.type === 'pie';
    var shown = allValues;                            // what the notes are made from
    if (pie) {
      var total = 0, negative = false;
      allValues[0].forEach(function (v) { if (v !== null) { total += v; if (v < 0) { negative = true; } } });
      if (negative || total <= 0) { markUnavailable(g, CONFIG.text.pieInvalid); return false; }
      shown = [allValues[0].map(function (v) { return v === null ? null : v / total * 100; })];
    }
    g.firstIndex = 0;
    g.lastIndex = rows - 1;
    g.rowAt = function (progress) { return progress * rows; };   // what onPosition reports: the bar being played, and how far through it

    var voiceCount = shown.length;   // for a grouped bar chart, each bar is divided into this many turns (see buildControlBuffer)
    g.voices = shown.map(function (vals, vIndex) {
      var points = [];
      vals.forEach(function (v, i) { if (v !== null) { points.push({ index: i, y: v, label: g.rowLabels[i] }); } });
      var lo = points[0], hi = points[0];
      points.forEach(function (p) {
        if (p.y < lo.y) { lo = p; }
        if (p.y > hi.y) { hi = p; }
      });
      var med = median(points.map(function (p) { return p.y; }));
      // A ting where the notes move from one side of the median to the other. A value exactly on the median
      // neither starts nor ends a crossing. For a grouped bar chart the crossing is timed to when this series'
      // own note plays within the bar (see buildControlBuffer), not to the start of the bar.
      var crossings = [], lastSide = 0;
      vals.forEach(function (v, i) {
        if (v === null) { return; }
        var side = v > med ? 1 : (v < med ? -1 : 0);
        if (side === 0) { return; }
        if (o.tings !== false && lastSide !== 0 && side !== lastSide) { crossings.push({ x: (i + vIndex / voiceCount) / rows, up: side > 0 }); }
        lastSide = side;
      });
      return {
        lo: lo, hi: hi, med: med, range: hi.y - lo.y,
        notes: vals.map(function (v) { return v === null ? null : midiToHz(noteFor(v, lo.y, med, hi.y)); }),   // Hz for each bar
        crossings: crossings,
        buffer: null
      };
    });

    // What is said for each bar or slice, and how much time each needs: the name (and value, if asked) has to fit.
    // Each cue is then scheduled with scheduleCues() (above) so it finishes right as its note begins, wherever
    // there is room to do so.
    g.speakValues = (o.speakValues !== undefined) ? o.speakValues === true : pie;
    var said = [], longest = 0;
    for (var i = 0; i < rows; i++) {
      var text = g.rowLabels[i];
      if (g.speakValues) { text += ', ' + spokenValue(g, shown, i); }
      said.push(text);
      longest = Math.max(longest, estimateSeconds(text, CONFIG.speechRate));
    }
    g.slotSeconds = Math.max(CONFIG.slotSeconds, longest + CONFIG.slotLabelPaddingSeconds);
    g.duration = rows * g.slotSeconds;
    var items = said.map(function (text, i) { return { x: i / rows, arrival: i * g.slotSeconds, label: text }; });
    g.cues = scheduleCues(items, CONFIG.cueGapSeconds);
    return true;
  }

  function spokenValue(g, shown, i) {
    if (g.type === 'pie') { return shown[0][i] === null ? 'no data' : fmt1(shown[0][i]) + ' percent'; }
    return shown.map(function (vals, v) {
      var unit = g.options.series[v].unit;
      return vals[i] === null ? 'no data' : fmt(vals[i]) + (unit ? ' ' + unit : '');
    }).join(' and ');
  }

  /* =========================================================================================
     AUDIO PLUMBING
     ========================================================================================= */
  function getContext() {
    if (!audioContext) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) { return null; }
      audioContext = new AC();
      audioContext.onstatechange = onContextStateChange;
    }
    return audioContext;
  }

  /* ---- iPhone and iPad -------------------------------------------------------
     Safari on iOS (and every other iPhone browser, which all use Safari's engine) treats Web Audio
     as "ambient" sound: the ring/silent switch mutes it, although speech and <audio> elements
     still play. So on iOS we (1) ask for the "playback" audio session, and keep a silent <audio>
     element playing as a back-up for versions that ignore that request, and (2) unlock Web Audio
     inside the tap on Play, because the tones only start after the spoken introduction, which is
     too late for the browser to accept a tap as permission. */
  function isIOS() {
    if (typeof navigator === 'undefined') { return false; }
    return /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPadOS pretends to be a Mac
  }

  function silentWavDataUri() {                      // 0.1 s of silence, built here so there is no file to host
    var samples = 800, rate = 8000, i;
    var buffer = new ArrayBuffer(44 + samples), view = new DataView(buffer);
    function put(offset, string) { for (var c = 0; c < string.length; c++) { view.setUint8(offset + c, string.charCodeAt(c)); } }
    put(0, 'RIFF'); view.setUint32(4, 36 + samples, true); put(8, 'WAVE'); put(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
    put(36, 'data'); view.setUint32(40, samples, true);
    for (i = 0; i < samples; i++) { view.setUint8(44 + i, 128); }      // 8-bit silence
    var bytes = new Uint8Array(buffer), binary = '';
    for (i = 0; i < bytes.length; i++) { binary += String.fromCharCode(bytes[i]); }
    return 'data:audio/wav;base64,' + btoa(binary);
  }

  function keepAudioSessionAlive() {
    if (!isIOS()) { return; }
    clearTimeout(releaseTimer);
    try { if (navigator.audioSession) { navigator.audioSession.type = 'playback'; } } catch (e) { /* not supported */ }
    if (typeof Audio === 'undefined') { return; }
    try {
      if (!silentAudio) {
        silentAudio = new Audio(silentWavDataUri());
        silentAudio.loop = true;
        if (silentAudio.setAttribute) { silentAudio.setAttribute('playsinline', ''); }
      }
      var started = silentAudio.play();
      if (started && started.catch) { started.catch(function () { /* blocked: the audioSession request still applies */ }); }
    } catch (e) { /* ignore */ }
  }

  function releaseAudioSession() {                    // a moment after the last graph has stopped
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(function () {
      if (!active && silentAudio) { try { silentAudio.pause(); } catch (e) { /* ignore */ } }
    }, 3000);
  }

  function resumeContext(ctx) {
    try {
      var resumed = ctx.resume();
      if (resumed && resumed.catch) { resumed.catch(function () { /* still blocked: we'll say so */ }); }
    } catch (e) { /* ignore */ }
  }

  // Everything that has to happen inside the tap on Play, before anything else
  function unlockAudio() {
    keepAudioSessionAlive();                          // before the context exists, so it starts in the right mode
    var ctx = getContext();
    if (!ctx) { return null; }
    resumeContext(ctx);
    try {                                             // a silent one-sample sound, played inside the tap, unlocks Web Audio on iOS
      var silence = ctx.createBufferSource();
      silence.buffer = ctx.createBuffer(1, 1, CONFIG.controlRate);
      silence.connect(ctx.destination);
      silence.start(0);
    } catch (e) { /* ignore */ }
    return ctx;
  }

  // If the browser pauses the sound behind our back (a phone call, leaving the page, speech taking over), carry on
  function onContextStateChange() {
    if (active && active.phase === 'tone' && !active.paused && audioContext.state !== 'running') { resumeContext(audioContext); }
  }

  // The sound didn't start (browser still blocking it): say so, and let Play try again inside a tap
  function checkSoundRunning(g, session) {
    setTimeout(function () {
      if (active !== session || session.paused) { return; }
      if (audioContext.state === 'running') { return; }
      session.blocked = true;
      setEnabled(g.buttons.play, true);
      g.status.textContent = CONFIG.text.blocked;
    }, 600);
  }

  // Reverb impulse response: stereo noise that dies away smoothly, softened so it sounds warm rather than hissy
  function makeImpulseResponse(ctx) {
    var rate = ctx.sampleRate;
    var length = Math.floor(CONFIG.reverbSeconds * rate);
    var preDelay = Math.floor(0.02 * rate);
    var buffer = ctx.createBuffer(2, length, rate);
    for (var channel = 0; channel < 2; channel++) {
      var data = buffer.getChannelData(channel), soft = 0;
      for (var i = preDelay; i < length; i++) {
        var t = (i - preDelay) / (length - preDelay);
        soft += 0.35 * ((Math.random() * 2 - 1) - soft);
        data[i] = soft * Math.pow(1 - t, CONFIG.reverbDecay);
      }
    }
    return buffer;
  }

  // Shared mixer: every graph's sound goes in at bus.input, out through dry + reverb
  function getBus(ctx) {
    if (!bus) {
      var input = ctx.createGain();
      var dry = ctx.createGain();
      var wet = ctx.createGain();
      var convolver = ctx.createConvolver();
      dry.gain.value = CONFIG.dryLevel;
      wet.gain.value = CONFIG.reverbLevel;
      if (!impulse) { impulse = makeImpulseResponse(ctx); }
      convolver.buffer = impulse;
      input.connect(dry);
      dry.connect(ctx.destination);
      input.connect(convolver);
      convolver.connect(wet);
      wet.connect(ctx.destination);
      bus = { input: input, nodes: [input, dry, convolver, wet] };
    }
    return bus;
  }

  function resetBus() {   // clears any reverb tail (used when a paused graph is stopped)
    if (!bus) { return; }
    bus.nodes.forEach(function (node) { try { node.disconnect(); } catch (e) { /* ignore */ } });
    bus = null;
  }

  // Channel 0 = pitch in Hz, channel 1 = volume.
  // Line graphs: a gliding pitch, silent where this series has no data, with short fades at its ends.
  // Bars and slices: one steady note per slot, each with a quick start and a short fade, so neighbours are heard separately.
  function buildControlBuffer(ctx, g, voice, v) {
    var volume = voiceSettings(v).volume;
    var rate = CONFIG.controlRate;
    var length = Math.round(g.duration * rate);
    var buffer = ctx.createBuffer(2, length, rate);
    var pitch = buffer.getChannelData(0), level = buffer.getChannelData(1);
    var i, progress;

    if (voice.notes) {
      // For a grouped bar chart (more than one series), each bar is shared between the series in turn,
      // rather than all playing at once: series one's note, then series two's, and so on. Each series is
      // silent outside its own turn. A single series (or a pie chart) has the whole bar to itself, which
      // is the same as before (voiceCount is 1, so its "turn" is the whole bar).
      var slots = g.rowCount, slot = g.slotSeconds, voiceCount = g.voices.length, turn = slot / voiceCount;
      var attack = Math.min(CONFIG.noteAttackSeconds, turn / 4), release = Math.min(CONFIG.noteReleaseSeconds, turn / 4);
      for (i = 0; i < length; i++) {
        progress = i / (length - 1);
        var position = progress * slots, k = Math.min(slots - 1, Math.floor(position));
        var withinBar = (position - k) * slot;                     // seconds into this bar
        var turnIndex = Math.min(voiceCount - 1, Math.floor(withinBar / turn));
        if (turnIndex !== v) { pitch[i] = 0; level[i] = 0; continue; }
        var t = withinBar - turnIndex * turn;                      // seconds into this series' own turn
        var hz = voice.notes[k];
        pitch[i] = hz === null ? 0 : hz;
        level[i] = hz === null ? 0 : volume * Math.max(0, Math.min(1, t / attack, (turn - t) / release));
      }
      return buffer;
    }

    var fade = CONFIG.fadeSeconds / g.duration;       // fade length as a fraction of the graph
    for (i = 0; i < length; i++) {
      progress = i / (length - 1);
      pitch[i] = voice.pitchAt(progress);
      level[i] = volume * Math.max(0, Math.min(1, (progress - voice.spanStart) / fade, (voice.spanEnd - progress) / fade));
    }
    return buffer;
  }

  function teardown(session) {
    (session.voices || []).forEach(function (voice) {
      try { voice.osc.stop(); } catch (e) { /* not started */ }
      [voice.source, voice.splitter, voice.osc, voice.env].concat(voice.extra).forEach(function (node) {
        try { node.disconnect(); } catch (e) { /* already disconnected */ }
      });
    });
    try { session.out.disconnect(); } catch (e) { /* already disconnected */ }
  }

  /* ---- Position tracking (drives the marker, the spoken labels and the tings) -- */
  function progressNow(session) {
    var elapsed = Math.max(0, audioContext.currentTime - session.markTime);
    return Math.min(1, session.markProgress + elapsed * session.rate / session.duration);
  }

  function tick() {
    if (!active || active.phase !== 'tone') { return; }
    var g = graphs[active.id];
    var progress = progressNow(active);
    report(g, g.rowAt(progress));
    // Bars and slices: every name is said, and the voice speeds up and slows down with the graph so each still fits its note
    var discrete = g.type !== 'line';
    var cueRate = discrete ? Math.min(3, CONFIG.speechRate * active.rate) : CONFIG.speechRate;
    while (active.nextCue < active.cues.length) {
      var candidate = active.cues[active.nextCue];
      var leadFraction = (candidate.leadSeconds || 0) * active.rate / active.duration;
      if (candidate.x > progress + leadFraction) { break; }
      active.nextCue++;
      active.lastSpokenX = candidate.x;
      speakCue(candidate.label, cueRate, discrete);
    }
    // Tings: scheduled slightly ahead, on the audio clock, so they land exactly on the crossing
    var tingAhead = CONFIG.tingLookaheadSeconds * active.rate / active.duration;
    g.voices.forEach(function (voice, v) {
      var state = active.voices[v];
      while (state.nextTing < voice.crossings.length && voice.crossings[state.nextTing].x <= progress + tingAhead) {
        var crossing = voice.crossings[state.nextTing++];
        state.lastTingX = crossing.x;
        var when = active.markTime + (crossing.x - active.markProgress) * active.duration / active.rate;
        var now = audioContext.currentTime;
        if (when >= now - 0.05) { playTing(active, v, Math.max(when, now), crossing.up); }   // too late (e.g. background tab): skip
      }
    });
  }

  function startTimer() { if (!timer) { timer = setInterval(tick, CONFIG.tickMilliseconds); } }
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

  function playTing(session, v, when, up) {
    var ctx = audioContext;
    var ting = voiceSettings(v).ting;
    var master = ctx.createGain();
    master.gain.value = ting.level;
    master.connect(session.voices[v].tingTarget);       // through the same fade-out and reverb as the tone
    ting.partials.forEach(function (partial) {
      var osc = ctx.createOscillator();
      var amp = ctx.createGain();
      osc.type = ting.wave;
      osc.frequency.value = midiToHz(up ? ting.noteUp : ting.noteDown) * partial.ratio;
      amp.gain.setValueAtTime(0.0001, when);
      amp.gain.linearRampToValueAtTime(partial.gain, when + 0.004);
      amp.gain.exponentialRampToValueAtTime(0.0001, when + partial.decay);
      osc.connect(amp);
      amp.connect(master);
      osc.start(when);
      osc.stop(when + partial.decay + 0.05);
    });
  }

  /* =========================================================================================
     TRANSPORT: play, pause, stop, speed
     ========================================================================================= */
  function play_(id) {
    var g = graphs[id];
    if (!g || !g.available) { return; }

    var ctx = unlockAudio();                          // inside the tap, so the browser lets the sound start later
    if (!ctx) { return; }

    if (active && active.id === id) {
      if (active.phase === 'tone' && active.paused) {   // paused: carry on
        active.paused = false;
        resumeContext(audioContext);
        startTimer();
        setState(id, 'playing', CONFIG.text.playing);
      } else if (active.phase === 'tone' && active.blocked) {   // the sound was blocked: this tap should have freed it
        active.blocked = false;
        setState(id, 'playing', CONFIG.text.playing);
        checkSoundRunning(g, active);
      }
      return;
    }

    stopIfActive();                                   // only one graph plays at a time

    revealPanel(g);
    cancelSpeech();

    var session = { id: id, phase: 'intro', paused: false };
    active = session;
    if (!introduced[id] && speechAvailable()) {
      introduced[id] = true;                          // the introduction is only read the first time
      setState(id, 'introducing', CONFIG.text.introducing);
      startIntro(g, session);
      g.voices.forEach(function (voice, v) {           // ready before the introduction ends
        if (!voice.buffer) { voice.buffer = buildControlBuffer(ctx, g, voice, v); }
      });
    } else {
      beginTone(g, session);
    }
  }

  // If anything goes wrong starting the sound, say so rather than staying silent
  function beginTone(g, session) {
    try {
      startTone(g, session);
    } catch (error) {
      if (global.console && console.error) { console.error('AudioGraph: the sound could not start', error); }
      if (active === session) { active = null; }
      stopTimer();
      cancelSpeech();
      teardown(session);
      setState(session.id, 'stopped', CONFIG.text.failed);
    }
  }

  function startTone(g, session) {
    var ctx = audioContext;
    resumeContext(ctx);
    var speed = Number(g.speedSelect.value) || 1;
    var start = ctx.currentTime + 0.05;
    var out = ctx.createGain();                       // shared by all voices; used for the fade-out when stopping
    out.connect(getBus(ctx).input);

    session.out = out;
    session.voices = g.voices.map(function (voice, v) {
      if (!voice.buffer) { voice.buffer = buildControlBuffer(ctx, g, voice, v); }
      var settings = voiceSettings(v);
      var source = ctx.createBufferSource();
      source.buffer = voice.buffer;
      source.playbackRate.value = speed;
      var splitter = ctx.createChannelSplitter(2);
      var osc = ctx.createOscillator();
      osc.type = settings.waveform;
      osc.frequency.value = 0;                        // the control buffer supplies the whole pitch
      var env = ctx.createGain();
      env.gain.value = 0;                             // ...and the whole volume

      source.connect(splitter);
      splitter.connect(osc.frequency, 0);
      splitter.connect(env.gain, 1);
      osc.connect(env);

      var tail = env, extra = [];
      if (settings.cutoff) {                          // soften the tone
        var filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = settings.cutoff;
        tail.connect(filter);
        tail = filter;
        extra.push(filter);
      }
      var tingTarget = out;
      if (g.voices.length > 1 && settings.pan && ctx.createStereoPanner) {   // when two voices play, spread them left and right
        var panner = ctx.createStereoPanner();
        panner.pan.value = settings.pan;
        tail.connect(panner);
        tail = panner;
        tingTarget = panner;
        extra.push(panner);
      }
      tail.connect(out);
      osc.start(start);
      source.start(start);
      return { source: source, splitter: splitter, osc: osc, env: env, extra: extra, tingTarget: tingTarget, nextTing: 0, lastTingX: -1 };
    });

    session.phase = 'tone';
    session.startTime = start;
    session.duration = g.duration;
    session.rate = speed; session.markTime = start; session.markProgress = 0;
    session.cues = buildCues(g, speed); session.nextCue = 0; session.lastSpokenX = -1;

    session.voices[0].source.onended = function () {  // reached the end naturally
      if (active === session) {
        active = null;
        stopTimer();
        // Deliberately not cancelling speech here: the last label is allowed to finish
        teardown(session);
        releaseAudioSession();
        setState(session.id, 'stopped', CONFIG.text.finished);
      }
    };
    setState(session.id, 'playing', CONFIG.text.playing);
    startTimer();
    tick();           // shows the marker and says the first label straight away
    checkSoundRunning(g, session);
  }

  function pause_(id) {
    if (!active || active.id !== id || active.phase !== 'tone' || active.paused) { return; }
    active.paused = true;
    stopTimer();
    cancelSpeech();
    audioContext.suspend();    // freezes the audio clock, so the tones wait exactly where they are
    setState(id, 'paused', CONFIG.text.paused);
  }

  // Stops whatever is active; with an id, only if it is that graph
  function stopIfActive(id) {
    if (!active || (id !== undefined && active.id !== id)) { return; }
    var session = active;
    active = null;
    stopTimer();
    cancelSpeech();
    if (session.phase === 'intro') {                  // still reading the description
      session.introDone = true;
      clearTimeout(session.watchdog);
      runCleanups(session);
      if (graphs[session.id]) { clearHighlight(graphs[session.id]); }
    } else {
      session.voices.forEach(function (voice) { voice.source.onended = null; });
      if (session.paused) {
        teardown(session);
        resetBus();
      } else {
        var now = audioContext.currentTime;
        session.out.gain.setTargetAtTime(0, now, 0.015);
        session.voices.forEach(function (voice) {
          try { voice.source.stop(now + 0.1); } catch (e) { /* already stopped */ }
        });
        session.voices[0].source.onended = function () { teardown(session); };
      }
    }
    releaseAudioSession();
    setState(session.id, 'stopped', CONFIG.text.stopped);
  }

  // Speed can change while playing: carry on from the same place at the new rate
  function applySpeed(id) {
    var g = graphs[id];
    if (!g || !active || active.id !== id || active.phase !== 'tone') { return; }
    var speed = Number(g.speedSelect.value) || 1;
    active.markProgress = progressNow(active);
    active.markTime = Math.max(audioContext.currentTime, active.startTime);
    active.rate = speed;
    active.cues = buildCues(g, speed);
    active.nextCue = firstUnspokenCue(active);
    active.voices.forEach(function (state, v) {
      state.source.playbackRate.value = speed;
      var crossings = g.voices[v].crossings;
      state.nextTing = 0;
      while (state.nextTing < crossings.length && crossings[state.nextTing].x <= state.lastTingX + 1e-9) { state.nextTing++; }
    });
  }

  /* =========================================================================================
     PUBLIC API
     ========================================================================================= */
  function checkOptions(options) {
    var series = options && options.series;
    var type = (options && options.type) || 'line';
    if (['line', 'bar', 'pie'].indexOf(type) === -1) {
      throw new Error('AudioGraph.add: "type" must be "line", "bar" or "pie".');
    }
    if (!series || !series.length) {
      throw new Error('AudioGraph.add: "series" must be an array of one or two series, each like { name: "...", values: [1, 2, 3] }.');
    }
    if (series.length > CONFIG.voices.length) {
      throw new Error('AudioGraph.add: at most ' + CONFIG.voices.length + ' series can be played together.');
    }
    if (type === 'pie' && series.length !== 1) {
      throw new Error('AudioGraph.add: a pie chart has just one series.');
    }
    var rows = series[0] && series[0].values ? series[0].values.length : -1;
    series.forEach(function (s, i) {
      if (!s || !s.values || typeof s.values.length !== 'number') {
        throw new Error('AudioGraph.add: series ' + (i + 1) + ' needs a "values" array.');
      }
      if (s.values.length !== rows) {
        throw new Error('AudioGraph.add: every series needs the same number of values (series 1 has ' + rows + ', series ' + (i + 1) + ' has ' + s.values.length + ').');
      }
    });
    if (options.labels && options.labels.length !== rows) {
      throw new Error('AudioGraph.add: "labels" needs one label for each value (' + rows + ' values, ' + options.labels.length + ' labels).');
    }
  }

  function titleFor(options) {
    if (options.title) { return String(options.title); }
    return options.series.map(function (s) { return s.name; }).filter(Boolean).join(' compared with ') || 'Graph';
  }

  function add(container, options) {
    if (!container || typeof container.appendChild !== 'function') {
      throw new Error('AudioGraph.add: the first argument must be the element to put the controls in.');
    }
    options = options || {};
    checkOptions(options);
    var id = String(options.id || 'graph-' + (++counter));
    if (graphs[id]) { throw new Error('AudioGraph.add: there is already a graph with the id "' + id + '".'); }

    var g = { id: id, options: options, container: container, type: options.type || 'line', title: titleFor(options), state: 'stopped', highlighted: null, voices: [], sentences: [], available: false };
    graphs[id] = g;
    buildControls(g);
    prepare(g);

    return {
      id: id,
      play: function () { play_(id); },
      pause: function () { pause_(id); },
      stop: function () { stopIfActive(id); },
      // New data or options (for example after your chart has been redrawn with different data).
      // The introduction will be read again the next time Play is pressed.
      update: function (changes) {
        var merged = {};
        Object.keys(g.options).forEach(function (key) { merged[key] = g.options[key]; });
        Object.keys(changes || {}).forEach(function (key) { merged[key] = changes[key]; });
        checkOptions(merged);
        stopIfActive(id);
        g.options = merged;
        g.title = titleFor(merged);
        g.type = merged.type || 'line';
        delete introduced[id];
        prepare(g);
      },
      // Remove the controls and forget the graph (for single-page apps)
      destroy: function () {
        stopIfActive(id);
        if (g.group.parentNode) { g.group.parentNode.removeChild(g.group); }
        delete graphs[id];
        delete introduced[id];
      }
    };
  }

  /* ---- Page-level behaviour ---------------------------------------------- */
  if (global.addEventListener) {
    global.addEventListener('pagehide', function () { stopIfActive(); });   // leaving the page: silence
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () {   // coming back to the page: wake the sound if the browser paused it
      if (!document.hidden && active && active.phase === 'tone' && !active.paused && audioContext.state !== 'running') { resumeContext(audioContext); }
    });
  }

  var api = {
    add: add,
    median: median,                                   // for drawing the median line on your chart
    stopAll: function () { stopIfActive(); },
    isSupported: function () { return !!(global.AudioContext || global.webkitAudioContext); },
    config: CONFIG
  };
  global.AudioGraph = api;
  if (typeof module === 'object' && module.exports) { module.exports = api; }
})(typeof window !== 'undefined' ? window : this);
