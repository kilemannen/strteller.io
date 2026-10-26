# Størrelsen teller v1.6.0

Måler nedlasting, opplasting, ping og jitter på linja di mot Cloudflare. Kun på WiFi eller kabel: testen sperres på mobilnett.

Appen er én fil, `index.html`, uten byggesteg.

## Tester
Appen er utviklet med test først (TDD) fra og med 1.6.0. Testene kjører appens eget skript i en simulert nettleser, med simulert nettverk og falsk klokke, så en hel måling på 20 sekunder tar et brøkdels sekund.

```
npm test
```

Krever Node 22 eller nyere. Ingen avhengigheter.

| Fil | Hva den tester |
|---|---|
| `test/gauge.test.js` | Måleren: skala, bue, nål og tall, også med ugyldige verdier |
| `test/connection.test.js` | WiFi, kabel, mobil og offline, bekreftelse når nettleseren ikke oppgir type, serverinfo |
| `test/measure.test.js` | Ping og jitter, nedlasting, opplasting, hele testen, stopp, pauser, siste måling |
| `test/release.test.js` | Versjonsnummer og endringslogg er like overalt |
| `test/harness.js` | Den simulerte nettleseren |

Ved ny versjon: skriv testen først, endre så appen, og oppdater versjon i `package.json`, overskriften, `VERSION`, endringsloggen øverst i skriptet og lista under.

## Versjoner
- **1.6.0** – Måleren tåler ugyldige verdier (NaN, uendelig, negative) og viser 0 i stedet for «NaN» eller fullt utslag. Automatiske tester lagt til.
- **1.5.0** – Nytt navn: Størrelsen teller (tidligere Linjemåler).
- **1.4.3** – Stopp avbryter umiddelbart, 10 s pause etter stopp.
- **1.4.0** – Jitter, større speedometer.
- **1.3.0** – Siste resultat huskes med tidspunkt.
- **1.2.0** – Kun Cloudflare, serverinfo.
- **1.0.0** – Første versjon.
