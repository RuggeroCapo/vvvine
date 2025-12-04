# Requirements Document

## Introduction

Implementare un'interfaccia utente personalizzata per Amazon Vine che sostituisce completamente l'UI nativa di Amazon, caricando solo i dati necessari tramite richieste API dirette. Questo approccio, ispirato all'estensione ultraviner, migliora drasticamente le prestazioni eliminando il caricamento di elementi UI non necessari e riducendo il peso della pagina.

## Glossary

- **VineSystem**: L'estensione Chrome che gestisce l'interfaccia personalizzata di Amazon Vine
- **CustomUI**: L'interfaccia utente personalizzata che sostituisce l'UI nativa di Amazon
- **QueueAPI**: L'endpoint API di Amazon Vine che restituisce i dati degli item in formato JSON
- **ItemTile**: Un singolo elemento prodotto visualizzato nell'interfaccia
- **QueueType**: Il tipo di coda Vine (potluck, encore, last_chance, search)
- **NavigationTrigger**: Il parametro URL `vineenhancer=true` che attiva la modalità UI personalizzata
- **NativeUI**: L'interfaccia utente originale di Amazon Vine

## Requirements

### Requirement 1

**User Story:** Come utente di Vine, voglio un'interfaccia più veloce e leggera, così posso navigare gli item più rapidamente senza attendere il caricamento completo della pagina Amazon.

#### Acceptance Criteria

1. WHEN l'utente naviga a `https://www.amazon.it/vine/vine-items?vineenhancer=true` THEN il VineSystem SHALL intercettare la richiesta e attivare la CustomUI
2. WHEN la CustomUI è attivata THEN il VineSystem SHALL rimuovere completamente la NativeUI dalla pagina
3. WHEN la NativeUI è rimossa THEN il VineSystem SHALL caricare solo i dati necessari tramite QueueAPI
4. WHEN i dati sono caricati THEN il VineSystem SHALL renderizzare la CustomUI entro 500ms
5. WHEN la CustomUI è renderizzata THEN il VineSystem SHALL mostrare gli ItemTile in una griglia responsive

### Requirement 2

**User Story:** Come utente, voglio selezionare quale coda visualizzare, così posso navigare tra Potluck, Encore e Last Chance senza ricaricare la pagina.

#### Acceptance Criteria

1. WHEN la CustomUI è attiva THEN il VineSystem SHALL mostrare un selettore di coda nella parte superiore della pagina
2. WHEN l'utente seleziona un QueueType THEN il VineSystem SHALL richiedere i dati tramite GET `https://www.amazon.it/vine/vine-items?queue={QueueType}`
3. WHEN i dati della coda sono ricevuti THEN il VineSystem SHALL parsare la risposta HTML e estrarre gli ItemTile
4. WHEN gli ItemTile sono estratti THEN il VineSystem SHALL aggiornare la CustomUI senza ricaricare la pagina
5. WHEN la coda cambia THEN il VineSystem SHALL mantenere lo stato di scroll e filtri applicati

### Requirement 3

**User Story:** Come utente, voglio che l'estensione estragga i dati degli item dalla risposta HTML di Amazon, così posso visualizzare le informazioni rilevanti senza elementi superflui.

#### Acceptance Criteria

1. WHEN il VineSystem riceve la risposta da QueueAPI THEN il VineSystem SHALL parsare l'HTML utilizzando DOMParser
2. WHEN l'HTML è parsato THEN il VineSystem SHALL estrarre per ogni ItemTile: titolo, immagine, ASIN, ETV, categoria, recommendation ID
3. WHEN i dati sono estratti THEN il VineSystem SHALL validare che tutti i campi obbligatori siano presenti
4. IF un campo obbligatorio manca THEN il VineSystem SHALL escludere quell'ItemTile dalla visualizzazione
5. WHEN i dati sono validati THEN il VineSystem SHALL creare oggetti strutturati per ogni item

### Requirement 4

**User Story:** Come utente, voglio un'interfaccia pulita e minimalista, così posso concentrarmi sugli item senza distrazioni.

#### Acceptance Criteria

1. WHEN la CustomUI è renderizzata THEN il VineSystem SHALL mostrare solo: header con selettore coda, griglia item, paginazione
2. WHEN un ItemTile è visualizzato THEN il VineSystem SHALL mostrare: immagine, titolo (max 2 righe), ETV, categoria
3. WHEN l'utente passa il mouse su un ItemTile THEN il VineSystem SHALL mostrare azioni rapide: visualizza dettagli, ordina
4. WHEN la griglia è visualizzata THEN il VineSystem SHALL utilizzare CSS Grid con gap di 16px e colonne responsive
5. WHEN la pagina è caricata THEN il VineSystem SHALL applicare uno stile dark mode opzionale configurabile

### Requirement 5

**User Story:** Come utente, voglio che l'estensione gestisca la paginazione, così posso navigare tra le pagine di risultati senza ricaricare l'intera interfaccia.

#### Acceptance Criteria

1. WHEN la risposta contiene più pagine THEN il VineSystem SHALL estrarre il numero totale di pagine dalla risposta
2. WHEN il numero di pagine è estratto THEN il VineSystem SHALL mostrare controlli di paginazione in fondo alla pagina
3. WHEN l'utente clicca su una pagina THEN il VineSystem SHALL richiedere quella pagina tramite parametro `&page={numero}`
4. WHEN i dati della nuova pagina sono caricati THEN il VineSystem SHALL aggiornare la griglia senza ricaricare la CustomUI
5. WHEN la pagina cambia THEN il VineSystem SHALL scrollare automaticamente all'inizio della griglia

### Requirement 6

**User Story:** Come utente, voglio che l'estensione mantenga le funzionalità esistenti (filtri, color coding, rocket button), così non perdo le feature già implementate.

#### Acceptance Criteria

1. WHEN la CustomUI è attiva THEN il VineSystem SHALL applicare il color coding agli ItemTile (verde per nuovi, blu per target)
2. WHEN un ItemTile è renderizzato THEN il VineSystem SHALL aggiungere il rocket button se disponibile
3. WHEN i filtri sono applicati THEN il VineSystem SHALL filtrare gli ItemTile nella CustomUI
4. WHEN un item è ordinato THEN il VineSystem SHALL aggiornare lo stato e rimuovere l'ItemTile dalla griglia
5. WHEN la CustomUI è attiva THEN il VineSystem SHALL mantenere il tracking delle categorie e seen items

### Requirement 7

**User Story:** Come utente, voglio poter tornare all'interfaccia nativa di Amazon, così posso scegliere quale esperienza preferisco.

#### Acceptance Criteria

1. WHEN la CustomUI è attiva THEN il VineSystem SHALL mostrare un toggle "Modalità Nativa" nell'header
2. WHEN l'utente clicca il toggle THEN il VineSystem SHALL disattivare la CustomUI e ricaricare la pagina senza il parametro NavigationTrigger
3. WHEN l'utente naviga a una pagina Vine senza NavigationTrigger THEN il VineSystem SHALL utilizzare la NativeUI con le funzionalità esistenti
4. WHEN l'utente attiva la CustomUI THEN il VineSystem SHALL salvare la preferenza in storage
5. WHERE la preferenza CustomUI è salvata WHEN l'utente naviga a `/vine/vine-items` THEN il VineSystem SHALL reindirizzare automaticamente con NavigationTrigger

### Requirement 8

**User Story:** Come utente, voglio che l'estensione gestisca gli errori di rete, così posso continuare a usare l'interfaccia anche in caso di problemi temporanei.

#### Acceptance Criteria

1. IF la richiesta a QueueAPI fallisce THEN il VineSystem SHALL mostrare un messaggio di errore nella CustomUI
2. WHEN un errore di rete si verifica THEN il VineSystem SHALL offrire un pulsante "Riprova"
3. WHEN l'utente clicca "Riprova" THEN il VineSystem SHALL ripetere la richiesta fino a 3 volte con backoff esponenziale
4. IF tutte le richieste falliscono THEN il VineSystem SHALL offrire l'opzione di tornare alla NativeUI
5. WHEN un errore di parsing si verifica THEN il VineSystem SHALL loggare l'errore e mostrare gli item parsati correttamente

### Requirement 9

**User Story:** Come utente, voglio che l'interfaccia sia responsive, così posso usarla su schermi di diverse dimensioni.

#### Acceptance Criteria

1. WHEN la larghezza dello schermo è >= 1200px THEN il VineSystem SHALL mostrare 4 colonne nella griglia
2. WHEN la larghezza dello schermo è tra 768px e 1199px THEN il VineSystem SHALL mostrare 3 colonne
3. WHEN la larghezza dello schermo è tra 480px e 767px THEN il VineSystem SHALL mostrare 2 colonne
4. WHEN la larghezza dello schermo è < 480px THEN il VineSystem SHALL mostrare 1 colonna
5. WHEN la griglia è ridimensionata THEN il VineSystem SHALL mantenere le proporzioni degli ItemTile

### Requirement 10

**User Story:** Come utente, voglio che l'estensione carichi le immagini in modo efficiente, così la pagina rimane veloce anche con molti item.

#### Acceptance Criteria

1. WHEN un ItemTile è renderizzato THEN il VineSystem SHALL utilizzare lazy loading per le immagini
2. WHEN un'immagine entra nel viewport THEN il VineSystem SHALL caricare l'immagine con priorità normale
3. WHEN un'immagine non è ancora caricata THEN il VineSystem SHALL mostrare un placeholder con il colore di sfondo dell'item
4. IF il caricamento di un'immagine fallisce THEN il VineSystem SHALL mostrare un'icona placeholder
5. WHEN le immagini sono caricate THEN il VineSystem SHALL utilizzare dimensioni ottimizzate (300x300px)

## Non-Functional Requirements

### Performance
- Il caricamento iniziale della CustomUI deve completarsi entro 500ms
- Il parsing della risposta HTML deve completarsi entro 100ms
- Il cambio di coda deve aggiornare la UI entro 300ms
- La memoria utilizzata non deve superare 50MB per pagina

### Usability
- L'interfaccia deve essere intuitiva e non richiedere documentazione
- Il toggle tra CustomUI e NativeUI deve essere visibile e accessibile
- Gli errori devono essere comunicati in modo chiaro e non tecnico

### Reliability
- L'estensione deve gestire risposte HTML malformate senza crashare
- Il fallback alla NativeUI deve essere sempre disponibile
- Lo stato dell'applicazione deve essere consistente dopo errori

### Compatibility
- L'estensione deve funzionare su Chrome 90+
- L'estensione deve supportare amazon.it, amazon.com, amazon.de, amazon.fr, amazon.es, amazon.co.uk
- L'estensione deve essere compatibile con le funzionalità esistenti (managers)

### Security
- Le richieste API devono includere i token CSRF appropriati
- I dati degli item non devono essere memorizzati in modo persistente senza consenso
- L'estensione non deve esporre dati sensibili nei log

## Out of Scope

- Modifica dell'API di Amazon Vine
- Caching offline degli item
- Sincronizzazione multi-dispositivo
- Notifiche push per nuovi item
- Esportazione dati in formati esterni

## Dependencies

- Existing managers: storage, seen-items, filter, ui, new-items, purchase, color-coding
- Amazon Vine API endpoints (read-only)
- DOMParser API per parsing HTML
- Intersection Observer API per lazy loading

## Assumptions

- L'endpoint `/vine/vine-items?queue={type}` rimane stabile
- La struttura HTML della risposta non cambia drasticamente
- L'utente ha una connessione internet stabile
- L'utente accetta il rischio di usare un'interfaccia non ufficiale
