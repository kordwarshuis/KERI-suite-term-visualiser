export const CONFIG = {
    specs: [
        {
            id: 'keri',
            label: 'KERI',
            fullLabel: 'Key Event Receipt Infrastructure',
            url: 'https://trustoverip.github.io/kswg-keri-specification/',
            color: '#00ff8c',
        },
        {
            id: 'acdc',
            label: 'ACDC',
            fullLabel: 'Authentic Chained Data Containers',
            url: 'https://trustoverip.github.io/kswg-acdc-specification/',
            color: '#00b4ff',
        },
        {
            id: 'cesr',
            label: 'CESR',
            fullLabel: 'Composable Event Streaming Representation',
            url: 'https://trustoverip.github.io/kswg-cesr-specification/',
            color: '#ff8800',
        },
        {
            id: 'kerisuite',
            label: 'KERI Suite',
            fullLabel: 'KERI Suite',
            url: 'https://trustoverip.github.io/kerisuite-glossary/',
            color: '#cc44ff',
        },
        // {
        //     id: 'toip-glossary',
        //     label: 'ToIP Glossary',
        //     fullLabel: 'Trust over IP Glossary',
        //     url: 'https://glossary.trustoverip.org/',
        //     color: '#cc44ff',
        // },
        // {
        //   id:        'oobi',
        //   label:     'OOBI',
        //   fullLabel: 'Out-of-Band Introduction',
        //   url:       'https://trustoverip.github.io/kswg-oobi-specification/',
        //   color:     '#cc44ff',
        // },
    ],

    // CORS proxy used when direct fetch fails (leave '' to disable).
    // Format: prefix + encodeURIComponent(targetUrl)
    corsProxy: 'https://api.allorigins.win/raw?url=',

    // Physics tuning
    hubCharge: -1200,
    termCharge: -4000,
    externalCharge: -600,
    centerStrength: 0.06,
    clusterRadiusFraction: 0.38,

    // Simulation settling controls
    simulationVelocityDecay: 0.82,
    simulationAlphaDecay: 0.06,
    simulationAlphaMin: 0.02,

    // Auto-lite mode to keep interaction fluid on large graphs.
    perfModeMaxLinks: 700,
    perfModeMaxNodes: 350,
    perfLiteHideTermLabels: false,
    perfLiteDisableArrows: false,
};

export const specById = Object.fromEntries(CONFIG.specs.map(s => [s.id, s]));
export const specColor = {
    ...Object.fromEntries(CONFIG.specs.map(s => [s.id, s.color])),
    external: '#7a5520',
};
