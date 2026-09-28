/* ==========================================================================================
   demo.js - the demo page's own code. It does two jobs:

     1. Draws seven simple charts as inline SVG (four line graphs, two bar charts and a pie
        chart), so the demo needs no charting library, works offline, and can be opened
        straight from a folder.
     2. Gives each chart audio controls with AudioGraph.add().

   Job 2 is the only part you need to copy. Look for "STEP 3" below: it is just one call per
   chart. If you already have charts (Chart.js, Google Charts, D3, a plain <img>...), you don't
   need any of the drawing code: keep your charts and add the AudioGraph.add() call. See README.md.
   ========================================================================================== */
(function () {
  'use strict';

  /* =======================================================================================
     STEP 1 - THE DATA. Replace this with your own.

     A chart is a list of values, one for each label. Everything you see and hear is made from
     these arrays. Rules of thumb:
       - Each series needs the same number of values as there are labels.
       - Use null for a missing value.
       - The labels are SPOKEN as the chart plays, so write them out in full: "January", not
         "Jan"; "Work from home", not "Home". (A separate, shorter list is used for the axis.)
       - Write units the way you'd say them: "degrees Celsius", not "°C".
     The data is invented: a small town called Riverton.
     ======================================================================================= */
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var TRAVEL = ['Car', 'Bus', 'Walk', 'Train', 'Cycle', 'Work from home'];
  var TRAVEL_SHORT = ['Car', 'Bus', 'Walk', 'Train', 'Cycle', 'Home'];

  var SPENDING = ['Education', 'Social care', 'Roads and transport', 'Housing', 'Parks and leisure', 'Libraries', 'Other'];

  var SERIES = {
    // ---- line graphs: months of the year ----
    temperature: {
      name: 'Average temperature',
      unit: 'degrees Celsius',                 // how it is SAID
      axisTitle: 'Temperature (°C)',           // how it is SHOWN (demo charts only)
      color: '#1a5fb4',
      values: [4, 5, 8, 11, 15, 18, 21, 20, 17, 12, 7, 4]
    },
    rainfall: {
      name: 'Rainfall',
      unit: 'millimetres',
      axisTitle: 'Rainfall (mm)',
      color: '#c2410c',
      values: [78, 62, 55, 48, 52, 45, 41, 50, 58, 82, 90, 88]
    },
    visitors: {
      name: 'Park visitors',
      unit: 'thousand visitors',
      axisTitle: 'Visitors (thousands)',
      color: '#2b7a4b',
      // August is null: the counter broke. Notice the line bridges the gap, and the sound glides across it.
      values: [12, 14, 22, 35, 48, 60, 72, null, 44, 30, 16, 13]
    },
    // ---- bar charts: how residents travel to work (percent of residents) ----
    travel2005: {
      name: 'Residents in 2005',
      unit: 'percent',
      axisTitle: 'Percent of residents',
      color: '#1a5fb4',
      values: [52, 20, 14, 8, 5, 1]
    },
    travel2025: {
      name: 'Residents in 2025',
      unit: 'percent',
      axisTitle: 'Percent of residents',
      color: '#c2410c',
      values: [46, 17, 11, 10, 8, 8]
    },
    // ---- pie chart: where the council's money goes (millions of pounds; the pie works out the shares) ----
    spending: {
      name: 'Council spending',
      unit: 'million pounds',
      axisTitle: 'Spending (£ million)',
      values: [152, 96, 48, 36, 24, 12, 32]
    }
  };

  // Each chart: a `type` ('line', 'bar' or 'pie'), the spoken `labels`, the short `axisLabels` for
  // the picture, and its series. Each has a matching set of elements in index.html:
  // chart-<id>, controls-<id> and table-<id>.
  var GRAPHS = [
    { id: 'temperature', type: 'line', title: 'Average monthly temperature in Riverton', labels: MONTHS, axisLabels: MONTHS_SHORT, first: 'Month', series: [SERIES.temperature] },
    { id: 'rainfall',    type: 'line', title: 'Monthly rainfall in Riverton',            labels: MONTHS, axisLabels: MONTHS_SHORT, first: 'Month', series: [SERIES.rainfall] },
    { id: 'visitors',    type: 'line', title: 'Monthly visitors to Riverside Park',      labels: MONTHS, axisLabels: MONTHS_SHORT, first: 'Month', series: [SERIES.visitors] },
    { id: 'compare',     type: 'line', title: 'Temperature and rainfall in Riverton',    labels: MONTHS, axisLabels: MONTHS_SHORT, first: 'Month', series: [SERIES.temperature, SERIES.rainfall] },

    { id: 'bars',        type: 'bar',  title: 'How Riverton residents travel to work, 2025',        labels: TRAVEL, axisLabels: TRAVEL_SHORT, first: 'Way of travelling', series: [SERIES.travel2025] },
    { id: 'bars-compare', type: 'bar', title: 'How Riverton residents travel to work, 2005 and 2025', labels: TRAVEL, axisLabels: TRAVEL_SHORT, first: 'Way of travelling', series: [SERIES.travel2005, SERIES.travel2025] },

    { id: 'pie',         type: 'pie',  title: "Where Riverton Council's money goes",                labels: SPENDING, axisLabels: SPENDING, first: 'Service', series: [SERIES.spending] }
  ];

  /* =======================================================================================
     STEP 2 - DRAWING THE CHARTS (demo only: skip this if you have your own charts)

     The things worth noticing here are what a chart offers to be sonified:
       (a) for line and bar charts, the median line, drawn with AudioGraph.median(values), and
       (b) a function that shows where the sound is up to: setMarker(row).
           - Line graphs: a moving line. `row` is a position along the x axis, with a fraction.
           - Bar and pie charts: the bar or slice being played is highlighted. `row` is a slot
             number: its integer part is the bar or slice, so Math.floor(row) picks it out.
     ======================================================================================= */
  var SVG = 'http://www.w3.org/2000/svg';
  var DASHES = ['8 4', '2 5'];                  // series one's median is dashed, series two's is dotted

  function el(name, attributes, parent) {
    var node = document.createElementNS(SVG, name);
    Object.keys(attributes || {}).forEach(function (key) { node.setAttribute(key, attributes[key]); });
    if (parent) { parent.appendChild(node); }
    return node;
  }

  function valid(values) { return values.filter(function (v) { return v !== null && v !== undefined; }); }

  // Round the ends of an axis to tidy numbers, and pick the tick marks
  function niceScale(min, max) {
    if (min === max) { min -= 1; max += 1; }
    var rough = (max - min) / 5, power = Math.pow(10, Math.floor(Math.log10(rough))), fraction = rough / power;
    var step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
    var low = Math.floor(min / step) * step, high = Math.ceil(max / step) * step, ticks = [];
    for (var v = low; v <= high + step / 2; v += step) { ticks.push(Number(v.toFixed(10))); }
    return { min: low, max: high, ticks: ticks };
  }

  // Every chart is a picture, so it gets a text alternative: a title and a short description
  function makeSvg(spec, W, H, description) {
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-labelledby': 'title-' + spec.id + ' desc-' + spec.id });
    el('title', { id: 'title-' + spec.id }, svg).textContent = spec.title;
    el('desc', { id: 'desc-' + spec.id }, svg).textContent = description + ' Use the audio version below to hear it, or the data table.';
    return svg;
  }

  function legendItem(color, dash, text, thick) {
    var item = document.createElement('li');
    var swatch = el('svg', { viewBox: '0 0 40 12', 'aria-hidden': 'true' });
    el('line', { x1: 0, x2: 40, y1: 6, y2: 6, stroke: color, 'stroke-width': thick ? 10 : (dash ? 2 : 3), 'stroke-dasharray': dash || 'none' }, swatch);
    item.appendChild(swatch);
    item.appendChild(document.createTextNode(text));
    return item;
  }

  // ---------------------------------------------------------------- line graphs
  function drawLineChart(target, spec) {
    var series = spec.series, twoAxes = series.length > 1, rows = spec.labels.length;
    var W = 800, H = 430;
    var margin = { top: 24, right: twoAxes ? 76 : 40, bottom: 58, left: 76 };
    var plotW = W - margin.left - margin.right, plotH = H - margin.top - margin.bottom;

    // Each series gets its own y axis (left for the first, right for the second)
    var scales = series.map(function (s) { var v = valid(s.values); return niceScale(Math.min.apply(null, v), Math.max.apply(null, v)); });
    function xOf(row) { return margin.left + plotW * row / (rows - 1); }
    function yOf(scale, value) { return margin.top + plotH * (1 - (value - scale.min) / (scale.max - scale.min)); }

    var svg = makeSvg(spec, W, H, 'Line chart of ' + series.map(function (s) { return s.name.toLowerCase(); }).join(' and ') + ' for each month.');

    // Grid lines and the left axis (the grid follows the left axis)
    scales[0].ticks.forEach(function (tick) {
      var y = yOf(scales[0], tick);
      el('line', { x1: margin.left, x2: W - margin.right, y1: y, y2: y, 'class': 'demo-grid' }, svg);
      var label = el('text', { x: margin.left - 10, y: y + 4, 'text-anchor': 'end', 'class': 'demo-tick-label' }, svg);
      label.textContent = tick;
      if (twoAxes) { label.style.fill = series[0].color; }   // inline style, so it beats the stylesheet's grey
    });
    // The right axis, if there is one
    if (twoAxes) {
      scales[1].ticks.forEach(function (tick) {
        var label = el('text', { x: W - margin.right + 10, y: yOf(scales[1], tick) + 4, 'class': 'demo-tick-label' }, svg);
        label.textContent = tick;
        label.style.fill = series[1].color;
      });
      el('line', { x1: W - margin.right, x2: W - margin.right, y1: margin.top, y2: margin.top + plotH, 'class': 'demo-axis-line' }, svg);
    }
    el('line', { x1: margin.left, x2: margin.left, y1: margin.top, y2: margin.top + plotH, 'class': 'demo-axis-line' }, svg);
    el('line', { x1: margin.left, x2: W - margin.right, y1: margin.top + plotH, y2: margin.top + plotH, 'class': 'demo-axis-line' }, svg);

    // Axis titles
    var leftTitle = el('text', { x: 18, y: margin.top + plotH / 2, 'text-anchor': 'middle', 'class': 'demo-axis-title', transform: 'rotate(-90 18 ' + (margin.top + plotH / 2) + ')' }, svg);
    leftTitle.textContent = series[0].axisTitle;
    if (twoAxes) {
      var rightTitle = el('text', { x: W - 18, y: margin.top + plotH / 2, 'text-anchor': 'middle', 'class': 'demo-axis-title', transform: 'rotate(90 ' + (W - 18) + ' ' + (margin.top + plotH / 2) + ')' }, svg);
      rightTitle.textContent = series[1].axisTitle;
      rightTitle.style.fill = series[1].color;
      leftTitle.style.fill = series[0].color;
    }

    // The x axis labels (the short names: the spoken ones are longer)
    spec.axisLabels.forEach(function (name, row) {
      el('text', { x: xOf(row), y: margin.top + plotH + 24, 'text-anchor': 'middle', 'class': 'demo-tick-label' }, svg).textContent = name;
    });

    // The data. A missing value (null) is skipped, so the line bridges the gap.
    series.forEach(function (s, index) {
      var scale = scales[index], path = '';
      s.values.forEach(function (value, row) {
        if (value === null || value === undefined) { return; }
        path += (path ? ' L ' : 'M ') + xOf(row) + ' ' + yOf(scale, value);
      });
      el('path', { d: path, 'class': 'demo-line', stroke: s.color }, svg);

      // (a) THE MEDIAN LINE. AudioGraph.median() gives the same number the sound is built around.
      var median = window.AudioGraph ? AudioGraph.median(s.values) : null;
      if (median !== null) {
        el('line', { x1: margin.left, x2: W - margin.right, y1: yOf(scale, median), y2: yOf(scale, median),
                     'class': 'demo-median', stroke: s.color, 'stroke-dasharray': DASHES[index] }, svg);
      }

      s.values.forEach(function (value, row) {
        if (value === null || value === undefined) { return; }
        el('circle', { cx: xOf(row), cy: yOf(scale, value), r: 5, 'class': 'demo-point', fill: s.color }, svg);
      });
    });

    // (b) THE MOVING MARKER. Hidden until the sound is playing. AudioGraph calls setMarker(row)
    // about 30 times a second with the position as a row number that can have a fraction:
    // 0 = the first value, 2.5 = half way between the third and fourth values, and so on.
    // It calls setMarker(null) when playback stops.
    var marker = el('g', { display: 'none', 'aria-hidden': 'true' }, svg);
    var outline = el('line', { y1: margin.top, y2: margin.top + plotH, 'class': 'demo-marker-outline' }, marker);
    var line = el('line', { y1: margin.top, y2: margin.top + plotH, 'class': 'demo-marker' }, marker);
    function setMarker(row) {
      if (row === null || row === undefined) { marker.setAttribute('display', 'none'); return; }
      var x = xOf(row);
      outline.setAttribute('x1', x); outline.setAttribute('x2', x);
      line.setAttribute('x1', x); line.setAttribute('x2', x);
      marker.removeAttribute('display');
    }
    target.appendChild(svg);

    var legend = document.createElement('ul');
    legend.className = 'demo-legend';
    series.forEach(function (s, index) {
      var side = twoAxes ? (index === 0 ? ' (left axis)' : ' (right axis)') : '';
      legend.appendChild(legendItem(s.color, null, s.name + side));
      legend.appendChild(legendItem(s.color, DASHES[index], 'Median of ' + s.name.toLowerCase()));
    });
    target.appendChild(legend);
    return { setMarker: setMarker };
  }

  // ---------------------------------------------------------------- bar charts (one series, or grouped bars for two)
  function drawBarChart(target, spec) {
    var series = spec.series, groups = spec.labels.length, count = series.length;
    var W = 800, H = 430, margin = { top: 28, right: 28, bottom: 58, left: 76 };
    var plotW = W - margin.left - margin.right, plotH = H - margin.top - margin.bottom, bottom = margin.top + plotH;
    var everything = valid([].concat.apply([], series.map(function (s) { return s.values; })));
    var scale = niceScale(0, Math.max.apply(null, everything));            // bars start at zero
    function yOf(value) { return margin.top + plotH * (1 - (value - scale.min) / (scale.max - scale.min)); }
    var slotW = plotW / groups, groupW = slotW * 0.72, barW = groupW / count;

    var svg = makeSvg(spec, W, H, 'Bar chart of ' + series.map(function (s) { return s.name.toLowerCase(); }).join(' and ') + ' for each of ' + groups + ' ways of travelling.');
    scale.ticks.forEach(function (tick) {
      var y = yOf(tick);
      el('line', { x1: margin.left, x2: W - margin.right, y1: y, y2: y, 'class': 'demo-grid' }, svg);
      el('text', { x: margin.left - 10, y: y + 4, 'text-anchor': 'end', 'class': 'demo-tick-label' }, svg).textContent = tick;
    });
    el('line', { x1: margin.left, x2: margin.left, y1: margin.top, y2: bottom, 'class': 'demo-axis-line' }, svg);
    el('line', { x1: margin.left, x2: W - margin.right, y1: bottom, y2: bottom, 'class': 'demo-axis-line' }, svg);
    var title = el('text', { x: 18, y: margin.top + plotH / 2, 'text-anchor': 'middle', 'class': 'demo-axis-title', transform: 'rotate(-90 18 ' + (margin.top + plotH / 2) + ')' }, svg);
    title.textContent = series[0].axisTitle;

    // The bars, kept by slot so the one being played can be picked out
    var slots = spec.labels.map(function () { return []; });
    spec.axisLabels.forEach(function (name, i) {
      el('text', { x: margin.left + slotW * (i + 0.5), y: bottom + 24, 'text-anchor': 'middle', 'class': 'demo-tick-label' }, svg).textContent = name;
    });
    series.forEach(function (s, j) {
      s.values.forEach(function (value, i) {
        if (value === null || value === undefined) { return; }
        var x = margin.left + slotW * i + (slotW - groupW) / 2 + barW * j;
        slots[i].push(el('rect', { x: x, y: yOf(value), width: barW - 2, height: bottom - yOf(value), fill: s.color, 'class': 'demo-bar' }, svg));
        el('text', { x: x + (barW - 2) / 2, y: yOf(value) - 6, 'text-anchor': 'middle', 'class': 'demo-bar-value' }, svg).textContent = value;
      });
    });

    // (a) THE MEDIAN LINE: one per series, in its own colour
    series.forEach(function (s, j) {
      var median = window.AudioGraph ? AudioGraph.median(s.values) : null;
      if (median !== null) {
        el('line', { x1: margin.left, x2: W - margin.right, y1: yOf(median), y2: yOf(median), 'class': 'demo-median', stroke: s.color, 'stroke-dasharray': DASHES[j] }, svg);
      }
    });

    // (b) THE MARKER: the bar being played is outlined and the rest are dimmed. row = 2.5 means "half way through the third bar".
    function setMarker(row) {
      var current = (row === null || row === undefined) ? -1 : Math.min(groups - 1, Math.floor(row));
      slots.forEach(function (bars, i) {
        bars.forEach(function (bar) {
          bar.setAttribute('class', 'demo-bar' + (i === current ? ' is-playing' : ''));
          bar.setAttribute('opacity', (current === -1 || i === current) ? 1 : 0.4);
        });
      });
    }
    target.appendChild(svg);

    var legend = document.createElement('ul');
    legend.className = 'demo-legend';
    series.forEach(function (s, j) {
      legend.appendChild(legendItem(s.color, null, s.name, true));
      legend.appendChild(legendItem(s.color, DASHES[j], 'Median of ' + s.name.toLowerCase()));
    });
    target.appendChild(legend);
    return { setMarker: setMarker };
  }

  // ---------------------------------------------------------------- pie chart
  var PIE_COLORS = ['#0072B2', '#D55E00', '#009E73', '#E69F00', '#CC79A7', '#56B4E9', '#6c757d'];   // colour-blind-friendly

  function drawPieChart(target, spec) {
    var values = spec.series[0].values, total = valid(values).reduce(function (a, b) { return a + b; }, 0);
    var W = 800, H = 430, cx = 220, cy = 215, radius = 165;
    var svg = makeSvg(spec, W, H, 'Pie chart of ' + spec.series[0].name.toLowerCase() + ', with a slice for each of ' + values.length + ' services.');

    // Slices start at the top and run clockwise, in the order given
    var slices = [], angle = -Math.PI / 2;
    values.forEach(function (value, i) {
      var sweep = value / total * 2 * Math.PI, end = angle + sweep, mid = angle + sweep / 2;
      var x1 = cx + radius * Math.cos(angle), y1 = cy + radius * Math.sin(angle), x2 = cx + radius * Math.cos(end), y2 = cy + radius * Math.sin(end);
      var path = el('path', { d: 'M ' + cx + ' ' + cy + ' L ' + x1 + ' ' + y1 + ' A ' + radius + ' ' + radius + ' 0 ' + (sweep > Math.PI ? 1 : 0) + ' 1 ' + x2 + ' ' + y2 + ' Z',
                              fill: PIE_COLORS[i % PIE_COLORS.length], 'class': 'demo-slice' }, svg);
      slices.push({ path: path, dx: Math.cos(mid) * 16, dy: Math.sin(mid) * 16 });
      angle = end;
    });

    // The key: a swatch, the name, the share and the amount, one row per slice
    var keys = spec.labels.map(function (name, i) {
      var y = 60 + i * 46;
      el('rect', { x: 470, y: y - 14, width: 22, height: 22, fill: PIE_COLORS[i % PIE_COLORS.length], rx: 3 }, svg);
      var label = el('text', { x: 502, y: y + 3, 'class': 'demo-key' }, svg);
      label.textContent = name + ': ' + Math.round(values[i] / total * 1000) / 10 + '%';
      return label;
    });

    // THE MARKER: the slice being played pulls out from the pie, and the rest are dimmed.
    // row = 2.5 means "half way through the third slice".
    function setMarker(row) {
      var current = (row === null || row === undefined) ? -1 : Math.min(values.length - 1, Math.floor(row));
      slices.forEach(function (slice, i) {
        var on = i === current;
        slice.path.setAttribute('transform', on ? 'translate(' + slice.dx + ' ' + slice.dy + ')' : '');
        slice.path.setAttribute('opacity', (current === -1 || on) ? 1 : 0.4);
        slice.path.setAttribute('class', 'demo-slice' + (on ? ' is-playing' : ''));
        keys[i].setAttribute('class', 'demo-key' + (on ? ' is-playing' : ''));
      });
    }
    target.appendChild(svg);
    return { setMarker: setMarker };
  }

  var DRAW = { line: drawLineChart, bar: drawBarChart, pie: drawPieChart };

  // The data as a table. Good practice: the audio version sits ALONGSIDE the table, it doesn't replace it.
  function drawTable(target, spec) {
    var columns = spec.series.map(function (s) { return { title: s.axisTitle, values: s.values }; });
    if (spec.type === 'pie') {                          // a pie's table also shows each slice's share
      var values = spec.series[0].values, total = valid(values).reduce(function (a, b) { return a + b; }, 0);
      columns.push({ title: 'Share of total', values: values.map(function (v) { return (Math.round(v / total * 1000) / 10) + '%'; }) });
    }
    var details = document.createElement('details');
    details.className = 'demo-table';
    var summary = document.createElement('summary');
    summary.textContent = 'View the data as a table';
    details.appendChild(summary);
    var table = document.createElement('table');
    var caption = document.createElement('caption');
    caption.textContent = spec.title;
    table.appendChild(caption);
    var head = table.createTHead().insertRow();
    [spec.first].concat(columns.map(function (c) { return c.title; })).forEach(function (text) {
      var th = document.createElement('th'); th.scope = 'col'; th.textContent = text; head.appendChild(th);
    });
    var body = table.createTBody();
    spec.labels.forEach(function (label, row) {
      var tr = body.insertRow();
      var th = document.createElement('th'); th.scope = 'row'; th.textContent = label; tr.appendChild(th);
      columns.forEach(function (c) {
        var value = c.values[row];
        tr.insertCell().textContent = (value === null || value === undefined) ? 'no data' : value;
      });
    });
    details.appendChild(table);
    target.appendChild(details);
  }

  /* =======================================================================================
     STEP 3 - ADD THE AUDIO. This is the part to copy.

     AudioGraph.add(element, options) builds the Play / Pause / Stop buttons and speed control
     inside `element`, and returns an object with play(), pause(), stop(), update() and destroy().

     `type` says how the data is played:
       'line'  one gliding tone follows the line (the default)
       'bar'   each bar is a separate note, in turn, and its name is spoken
       'pie'   each slice is a separate note, in turn, and its name and share are spoken
     ======================================================================================= */
  GRAPHS.forEach(function (spec) {
    var chart = DRAW[spec.type](document.getElementById('chart-' + spec.id), spec);
    drawTable(document.getElementById('table-' + spec.id), spec);

    if (!window.AudioGraph) { return; }
    AudioGraph.add(document.getElementById('controls-' + spec.id), {
      id: spec.id,                       // must be unique on the page
      type: spec.type,                   // 'line', 'bar' or 'pie'
      title: spec.title,                 // announced before the graph plays
      labels: spec.labels,               // one per value; spoken as they are reached
      series: spec.series.map(function (s, index) {
        return {
          name: s.name,                  // used in the spoken description
          unit: s.unit,                  // said after each number: "21 degrees Celsius"
          values: s.values,              // numbers, or null for missing
          // Only for a comparison with two y axes: which side each axis is on, so the description
          // can say so. (Our grouped bars share one axis, so they leave it out.)
          axis: (spec.type === 'line' && spec.series.length > 1) ? (index === 0 ? 'left' : 'right') : undefined
        };
      }),
      medianLine: spec.type !== 'pie',   // tells listeners the chart draws the median (we did, above). A pie has none.
      // speakValues: true,              // bars are named only; set this to have their values said as well (pies always say their share)
      onPosition: chart.setMarker        // called with the current position while playing, and null when stopped
    });
  });
})();
