// Admin: train the sign model in the browser from the saved recordings, check the result, then publish it.
// Works on Vercel: recordings and the published model live in MongoDB, training runs on this device.
(function () {
    const $ = id => document.getElementById(id);
    const els = {
        train: $('lmTrainBtn'), publish: $('lmPublishBtn'), force: $('lmPublishAnyway'), forceRow: $('lmPublishAnywayRow'),
        progress: $('lmTrainProgress'), status: $('lmTrainStatus'), report: $('lmTrainReport'), info: $('lmModelInfo'),
    };
    if (!els.train || !window.LandmarkTrainer) return;

    const PAGE = 80;
    const token = () => localStorage.getItem('admin_token') || '';
    const auth = () => ({ 'Authorization': token(), 'Content-Type': 'application/json' });
    let result = null;
    let busy = false;

    const say = text => { els.status.textContent = text; };

    async function api(path, options) {
        const res = await fetch(`${API_BASE}${path}`, Object.assign({ headers: auth() }, options));
        let data = {};
        try { data = await res.json(); } catch (e) { /* non-JSON error page */ }
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
        return data;
    }

    async function refreshInfo() {
        try {
            const data = await api('/admin/landmarks/summary');
            const m = data.model;
            els.info.textContent = m && m.labels
                ? `Published model: ${m.labels.length} signs (${m.labels.join(', ')})${m.trained_at ? ', trained ' + m.trained_at : ''}.`
                : 'No model published yet. The translator will not recognise signs until you train and publish one.';
        } catch (e) {
            els.info.textContent = '';
        }
    }

    async function downloadSamples() {
        const samples = [];
        let total = Infinity;
        while (samples.length < total) {
            const page = await api(`/admin/landmarks/export?skip=${samples.length}&limit=${PAGE}`);
            total = page.total;
            if (!page.samples.length) break;
            samples.push(...page.samples);
            els.progress.max = 100;
            els.progress.value = total ? Math.round(10 * samples.length / total) : 0;
            say(`Downloading recordings: ${samples.length} of ${total}`);
        }
        return samples;
    }

    function row(table, cells, header) {
        const tr = document.createElement('tr');
        cells.forEach(text => {
            const td = document.createElement(header ? 'th' : 'td');
            td.textContent = text;
            tr.appendChild(td);
        });
        table.appendChild(tr);
    }

    function pct(v) { return v === null || v === undefined ? 'n/a' : `${Math.round(v * 100)}%`; }

    function showReport(report) {
        els.report.innerHTML = '';
        const head = document.createElement('p');
        head.textContent = `${report.recordings} recordings from ${report.signers} signer${report.signers === 1 ? '' : 's'}, `
            + `${report.labels.length} signs. Accuracy on data held back for testing: ${pct(report.accuracy)}`
            + (report.confidentAccuracy !== null ? ` (when the model is at least 80% sure it is right ${pct(report.confidentAccuracy)} of the time, on ${pct(report.confidentShare)} of frames)` : '')
            + (report.split.optimistic ? '. Tested on the same signers it learned from, so treat this as optimistic.' : `. Tested on signers it never saw: ${report.split.holdoutSigners.join(', ')}.`);
        els.report.appendChild(head);

        const table = document.createElement('table');
        row(table, ['Sign', 'Recordings', 'Test recall'], true);
        report.perLabel.forEach((p, i) => row(table, [p.label, String(p.recordings), pct(report.perSign[i] ? report.perSign[i].recall : null)]));
        els.report.appendChild(table);

        if (report.warnings.length) {
            const ul = document.createElement('ul');
            report.warnings.forEach(w => { const li = document.createElement('li'); li.textContent = w; ul.appendChild(li); });
            els.report.appendChild(ul);
        }
    }

    els.train.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        result = null;
        els.train.disabled = true;
        els.publish.disabled = true;
        els.forceRow.hidden = true;
        els.report.innerHTML = '';
        els.progress.hidden = false;
        els.progress.value = 0;
        try {
            const samples = await downloadSamples();
            if (!samples.length) throw new Error('No recordings saved yet. Use "Record Sign Data" above first.');
            const out = await LandmarkTrainer.train(samples, {}, p => {
                els.progress.value = 10 + Math.round(90 * p.fraction);
                say(p.text);
            });
            result = out;
            showReport(out.report);
            const ok = out.report.publishable;
            els.publish.disabled = !ok;
            els.forceRow.hidden = ok;
            els.force.checked = false;
            say(ok ? 'Training finished. Review the results, then publish.'
                   : 'Training finished, but accuracy is low or could not be measured. Record more data, or tick the box to publish anyway.');
        } catch (e) {
            say('Training stopped: ' + e.message);
        } finally {
            busy = false;
            els.train.disabled = false;
            els.progress.hidden = true;
        }
    });

    els.force.addEventListener('change', () => { els.publish.disabled = !(result && els.force.checked); });

    els.publish.addEventListener('click', async () => {
        if (!result) return;
        els.publish.disabled = true;
        say('Publishing...');
        try {
            const r = result.report;
            await api('/admin/landmark-model', {
                method: 'PUT',
                body: JSON.stringify({
                    model: result.model,
                    metrics: {
                        accuracy: r.accuracy, signers: r.signers, recordings: r.recordings,
                        optimistic: r.split.optimistic, trained_at_browser: r.trainedAt,
                    },
                }),
            });
            say('Published. The translator picks up the new model within about a minute (reload it to use it now).');
            refreshInfo();
        } catch (e) {
            say('Not published: ' + e.message);
            els.publish.disabled = false;
        }
    });

    refreshInfo();
    // The page loads before the admin logs in, so refresh when the card first scrolls into view.
    if ('IntersectionObserver' in window) {
        new IntersectionObserver((entries, obs) => {
            if (entries[0].isIntersecting && token()) { refreshInfo(); obs.disconnect(); }
        }).observe($('modelTraining'));
    }
})();
