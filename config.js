/*!
 * AudioGraph configuration.
 *
 * This is the file you are expected to edit. Every setting AudioGraph uses lives here: the
 * pitch range, timing, volumes, and every word the controls show or speak, including the
 * sentences making up the spoken and on-screen description.
 *
 * audiograph.js is the engine that reads these settings; you shouldn't normally need to open
 * it, let alone change it, unless you are forking AudioGraph for deeper customisation (see its
 * own header comment).
 *
 * Load this file before audiograph.js:
 *
 *   <script src="config.js"></script>
 *   <script src="audiograph.js"></script>
 *
 * To change a setting after the page has loaded (rather than editing the default here), assign
 * to the same object under AudioGraph.config, e.g. AudioGraph.config.reverbLevel = 0; both names
 * point at this same object, so either works.
 */
window.AudioGraphConfig = {
    baseDurationSeconds: 15,   // length of a graph at normal speed
    lowNote: 55,               // MIDI 55 = G below middle C (the lowest value)
    highNote: 79,              // MIDI 79 = G above the C above middle C (the highest value)
    // The median plays the note half-way between the two: MIDI 67 = G above middle C.

    // The voices. A single graph uses the first; comparing two series glides them together on a
    // line graph, or gives each its own turn within a bar on a bar chart.
    voices: [
      {                        // first series: a smooth sine tone, with a bell-like ting
        waveform: 'sine',      // 'sine', 'triangle', 'sawtooth' or 'square'
        volume: 0.2,           // 0 to 1
        pan: -0.4,             // -1 (left) to 1 (right). Only used when there is more than one series. 0 = centre
        ting: {
          noteUp: 91,          // MIDI 91 = G6: the ting when the series crosses its median going UP
          noteDown: 84,        // MIDI 84 = C6: the lower ting when it crosses going DOWN
          level: 0.2,          // 0 to 1
          wave: 'sine',
          partials: [          // bell-like: a few partials, each dying away at its own speed
            { ratio: 1,    gain: 1,    decay: 0.7 },
            { ratio: 2.76, gain: 0.4,  decay: 0.3 },
            { ratio: 5.4,  gain: 0.15, decay: 0.15 }
          ]
        }
      },
      {                        // second series: a buzzier sawtooth tone, with a shorter, higher, softer tick
        waveform: 'sawtooth',
        volume: 0.1,           // a sawtooth sounds louder than a sine at the same level, so it is quieter
        cutoff: 2200,          // low-pass filter (Hz) to take the edge off the sawtooth. Remove for a harsher tone
        pan: 0.4,
        ting: {
          noteUp: 103,         // MIDI 103 = G7
          noteDown: 96,        // MIDI 96 = C7
          level: 0.14,
          wave: 'triangle',
          partials: [
            { ratio: 1, gain: 1,   decay: 0.22 },
            { ratio: 2, gain: 0.3, decay: 0.12 }
          ]
        }
      }
    ],
    tingLookaheadSeconds: 0.12, // tings are scheduled this far ahead so they land exactly on time

    fadeSeconds: 0.04,         // short fade in/out to avoid clicks
    controlRate: 22050,        // sample rate of the pitch/volume control buffers

    reverbSeconds: 2.5,        // length of the reverb tail
    reverbDecay: 3,            // higher = tail dies away faster
    reverbLevel: 0.3,          // wet (reverb) level, 0 = none
    dryLevel: 1,               // level of the direct sound

    // Spoken labels while the graph plays
    cueGapSeconds: 0.4,        // leave at least this much silence after one label before the next
    speechRate: 1.1,
    speechVolume: 0.8,

    // Spoken introduction (title + description)
    introSpeechRate: 1,
    introSpeechVolume: 1,
    highlightFallbackDelayMs: 500, // if the voice sends no word-by-word timing, estimate it after this long

    speechLang: 'en-GB',
    speechCharsPerSecond: 14,  // starting guess at speaking speed; it corrects itself as it hears real speech
    tickMilliseconds: 30,      // how often the position, spoken labels and tings are updated

    // Bar charts and pie charts: each bar or slice is one note
    slotSeconds: 1.5,             // time given to each bar or slice at normal speed (longer if its spoken name needs it)
    slotLabelPaddingSeconds: 0.5, // room left after the spoken name within that time
    noteAttackSeconds: 0.02,      // how quickly each note starts...
    noteReleaseSeconds: 0.08,     // ...and how long it takes to die away, leaving a small gap so equal neighbours sound like two notes

    speeds: [
      { value: 0.5,  name: 'Half speed' },
      { value: 0.75, name: 'Three-quarter speed' },
      { value: 1,    name: 'Normal speed' },
      { value: 1.5,  name: 'One and a half times speed' },
      { value: 2,    name: 'Double speed' }
    ],

    // Extra CSS classes for the controls, so they can match your site (e.g. Bootstrap: 'btn btn-secondary')
    classNames: { button: '', primaryButton: '', select: '' },

    // Every word the controls show or say. The description templates below (`descriptions`) are separate.
    text: {
      groupLabel: 'Audio version of {title}',
      play: 'Play',   playLabel: 'Play audio version of {title}',
      pause: 'Pause', pauseLabel: 'Pause audio version of {title}',
      stop: 'Stop',   stopLabel: 'Stop audio version of {title}',
      speed: 'Speed', speedLabel: 'Speed of audio version of {title}',
      speedOption: '{name} ({seconds} seconds)',
      introducing: 'Reading the description',
      playing: 'Playing',
      paused: 'Paused',
      stopped: 'Stopped',
      finished: 'Finished',
      blocked: 'The sound is blocked. Press Play to try again.',
      failed: 'Sorry, the sound could not start on this device.',
      unsupported: 'This browser cannot play audio graphs.',
      notEnoughData: 'An audio version is not available for this graph because there is not enough data.',
      notEnoughDataCompare: 'An audio version is not available for this comparison because one of the series has too little data.',
      pieInvalid: 'An audio version is not available for this pie chart because its values must add up to more than zero, with none negative.'
    },

    // The sentences AudioGraph builds the spoken and on-screen description from. {placeholders} are filled
    // in for you (numbers, names, labels...); see README.md for what each one provides. Edit these to
    // change the wording, or to translate AudioGraph into another language (together with `text`, above,
    // and `speechLang`).
    descriptions: {
      // A single line graph
      lineIntro: 'This audio version plays the graph {span}, taking {seconds} seconds at normal speed.',
      lineConstant: 'The value is constant at {value}, so the tone stays level.',
      lineTing: 'A short ting sounds each time the graph crosses the median, higher when going up and lower when going down.',

      // A single bar chart
      barIntro: 'This audio version plays each bar in turn, {span}, taking {seconds} seconds at normal speed.',
      barEachNoteWithValue: 'Each bar is played as a separate note, and its name and value are spoken.',
      barEachNoteNameOnly: 'Each bar is played as a separate note, and its name is spoken.',
      barConstant: 'The bars all have the same value, {value}, so every note is the same.',
      barTing: 'A short ting sounds when the bars move from one side of the median to the other, higher when going up and lower when going down.',

      // Shared by a single line graph and a single bar chart
      singleSubject: 'The graph shows {name}.',
      singleLowest: 'The lowest value is {value}{at}.',
      singleMedian: 'The median value is {value}.',
      singleHighest: 'The highest value is {value}{at}.',
      medianLineNote: 'The median is drawn on the chart as a horizontal line.',

      // A pie chart (always one series)
      pieIntro: 'This audio version plays each slice of the pie in turn, {span}, taking {seconds} seconds at normal speed.',
      pieEachNoteWithShare: 'Each slice is played as a separate note, and its name and share are spoken.',
      pieEachNoteNameOnly: 'Each slice is played as a separate note, and its name is spoken.',
      pieConstant: 'The slices are all the same size, so every note is the same.',
      pieSmallest: 'The smallest slice is {label}, at {value} percent.',
      pieMedian: 'The median slice is {value} percent.',
      pieLargest: 'The largest slice is {label}, at {value} percent.',
      pieTing: 'A short ting sounds when the slices move from one side of the median to the other, higher when going up and lower when going down.',

      // A comparison of two series (a line graph or a bar chart)
      compareIntroLine: 'This audio version compares {name1} with {name2}, playing {span}, taking {seconds} seconds at normal speed.',
      compareIntroBar: 'This audio version compares {name1} with {name2}, playing each bar in turn, {span}, taking {seconds} seconds at normal speed.',
      compareEachBarTurnWithValues: 'For each bar, the first series plays, then the second, and its name and values are spoken.',
      compareEachBarTurnNameOnly: 'For each bar, the first series plays, then the second, and its name is spoken.',
      compareFirstVoice: 'The first series{axis} is the smooth tone.',
      compareSecondVoice: 'The second series{axis} is the buzzy tone.',
      compareSummary: 'For the {which} series, the lowest value is {lowest}{lowAt}, the median is {median}, and the highest value is {highest}{highAt}.',
      compareSummaryConstant: 'For the {which} series, the value is constant at {value}.',
      compareMedianLine: 'Each median is drawn on the chart as a dashed horizontal line.',
      compareTingLine: 'A short ting sounds each time a series crosses its own median, higher when going up and lower when going down.',
      compareTingBar: 'A short ting sounds when a series moves from one side of its own median to the other, higher when going up and lower when going down.',
      compareTimbreNote: 'The first series has a bell-like ting, and the second has a shorter, higher tick.'
    }
};
