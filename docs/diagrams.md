# System diagrams

All diagrams use Mermaid. The section titled **Current implementation: preference-to-recommendation sequence** records the implemented client/API flow. Every other diagram in this file is a **target-state design** unless its heading explicitly says otherwise; it may include proposed services, entities, controls, and fields that are not implemented. Do not read target diagrams as deployment evidence. Update the current-state diagram when routes or response shapes change, and update target diagrams when the design changes.

## Context

```mermaid
flowchart LR
  seeker[Property seeker] -->|criteria and listing views| client[Persian RTL web/mobile client]
  operator[Authorized operator] -->|manual import and run review| client
  client -->|HTTPS JSON API| api[Cloudflare Worker API]
  api --> listings[(Cloudflare D1)]
  api --> rank[Recommendation service]
  rank --> listings
  api --> ingest[Ingestion coordinator]
  ingest --> listings
  demo[Demo fixtures] --> ingest
  file[Operator-provided import] --> ingest
  source[External source with documented permission] -. optional adapter .-> ingest
  ingest --> ops[Run status and sanitized logs]
```

## Use case

```mermaid
flowchart TB
  seeker((Property seeker))
  operator((Operator))
  subgraph platform[Real-estate recommendation platform]
    search[Enter search criteria]
    browse[Browse ranked listings]
    explain[Inspect match reasons and freshness]
    compare[Compare listing facts]
    import[Import authorized file]
    review[Review ingestion run and errors]
    enable[Review source permission and enable adapter]
  end
  seeker --> search
  seeker --> browse
  seeker --> explain
  seeker --> compare
  operator --> import
  operator --> review
  operator --> enable
  search --> browse
  browse --> explain
```

## Activity: search and recommendation

```mermaid
flowchart TD
  start([Start]) --> form[Submit search criteria]
  form --> validate{Criteria valid?}
  validate -- No --> errors[Return field errors]
  errors --> end1([End])
  validate -- Yes --> limit{Rate limit passed?}
  limit -- No --> throttled[Return 429]
  throttled --> end2([End])
  limit -- Yes --> query[Fetch candidate listings]
  query --> filter[Apply hard constraints]
  filter --> score[Calculate deterministic score and reasons]
  score --> freshness[Apply freshness labels]
  freshness --> sort[Sort with stable tie-breaker and paginate]
  sort --> response[Return results and metadata]
  response --> end3([End])
```

## Class/domain model

```mermaid
classDiagram
  class Listing {
    +string id
    +Intent intent
    +PropertyType propertyType
    +string city
    +number? areaSqm
    +int? rooms
    +int? salePrice
    +int? rentPrice
    +int? depositPrice
    +datetime firstSeenAt
    +datetime lastSeenAt
    +Freshness freshness
  }
  class Source {
    +string id
    +string name
    +SourceKind kind
    +bool enabled
    +PermissionStatus permissionStatus
  }
  class ListingObservation {
    +string id
    +string listingId
    +string sourceId
    +string? sourceRecordId
    +string contentHash
    +datetime observedAt
  }
  class IngestionRun {
    +string id
    +string sourceId
    +RunStatus status
    +int acceptedCount
    +int rejectedCount
    +int duplicateCount
  }
  class SearchCriteria {
    +Intent intent
    +string city
    +number? minPrice
    +number? maxPrice
    +number? minArea
    +number? maxArea
    +int page
    +int pageSize
  }
  class Recommendation {
    +string listingId
    +number score
    +string[] reasons
  }
  Listing "1" <-- "0..*" ListingObservation : observed as
  Source "1" <-- "0..*" ListingObservation : provides
  Source "1" <-- "0..*" IngestionRun : runs
  SearchCriteria ..> Recommendation : ranks
  Listing ..> Recommendation : candidate
```

## Current implementation: preference-to-recommendation sequence

```mermaid
sequenceDiagram
  actor Seeker
  participant Client as Web/mobile client
  participant API as Cloudflare Worker API
  participant Pref as D1 user_preferences
  participant Listings as D1 listings
  Seeker->>Client: Enter search criteria
  Client->>API: PUT /api/preferences/{uuidv4}
  API->>API: Validate UUIDv4 and preference schema
  API->>Pref: INSERT ... ON CONFLICT DO NOTHING
  alt UUID already used
    API-->>Client: 409 PREFERENCE_ID_ALREADY_USED
  else Created
    API-->>Client: 200 with id and preferences
    Client->>API: POST /api/recommendations/{uuidv4}
    API->>Pref: SELECT preference by ID
    Pref-->>API: Preference row
    API->>Listings: Query active listings for transaction type
    Listings-->>API: Candidate rows
    API->>API: Apply freshness and hard eligibility filters; score and rank
    API-->>Client: JSON { items: [{ listing, score, reasons }] }
  end
```

## Sequence: search (target architecture)

```mermaid
sequenceDiagram
  actor User as Seeker
  participant UI as RTL Client
  participant API as Worker API
  participant Repo as Listing Repository
  participant Rank as Recommendation Service
  participant DB as D1
  User->>UI: Submit criteria
  UI->>API: GET /api/listings (target contract; current route has no /v1 prefix)
  API->>API: Validate and rate-limit
  API->>Repo: Find candidates
  Repo->>DB: Parameterized query
  DB-->>Repo: Candidate rows and timestamps
  Repo-->>API: Candidate listings
  API->>Rank: Filter, score, explain
  Rank-->>API: Ranked results and reason codes
  API-->>UI: 200 JSON page
  UI-->>User: Render cards, reasons, freshness
```

## State: listing lifecycle

```mermaid
stateDiagram-v2
  [*] --> Candidate: observation imported
  Candidate --> Active: validation passes / canonicalized
  Candidate --> Rejected: invalid or unsafe data
  Active --> Active: new observation / fields reconciled
  Active --> Stale: freshness threshold exceeded
  Stale --> Active: observed again by authorized source
  Active --> Withdrawn: trusted withdrawal signal or operator decision
  Stale --> Withdrawn: trusted withdrawal signal or operator decision
  Withdrawn --> Active: later authorized observation confirms relisting
  Rejected --> [*]
```

## Component architecture

```mermaid
flowchart TB
  subgraph edge[Cloudflare edge]
    assets[Static assets / client]
    worker[Worker router and middleware]
    auth[Authentication and authorization]
    validation[Schema validation and rate limits]
    listingSvc[Listing service]
    recommend[Recommendation service]
    importSvc[Import and ingestion coordinator]
    adapter[Adapter registry and permission gate]
    repo[Repository layer]
  end
  db[(D1 database)]
  secrets[Worker secret bindings]
  telemetry[Sanitized logs and metrics]
  assets --> worker
  worker --> auth
  auth --> validation
  validation --> listingSvc
  validation --> importSvc
  listingSvc --> recommend
  listingSvc --> repo
  importSvc --> adapter
  importSvc --> repo
  adapter -. credentials only if required .-> secrets
  repo --> db
  worker --> telemetry
  importSvc --> telemetry
```

## Deployment

```mermaid
flowchart TB
  browser[User browser / mobile browser] -->|HTTPS| cf[Cloudflare edge]
  subgraph account[Cloudflare account / environment]
    pages[Static assets or Worker assets]
    worker[Worker API]
    d1[(D1 database)]
    sec[Secret bindings]
    logs[Logs and metrics]
  end
  cf --> pages
  cf --> worker
  worker --> d1
  worker --> sec
  worker --> logs
  operator[Authorized operator] -->|protected HTTPS API| worker
  fixture[Versioned demo fixtures] -->|seed/import task| d1
```

## ERD

```mermaid
erDiagram
  SOURCES ||--o{ LISTING_OBSERVATIONS : provides
  LISTINGS ||--o{ LISTING_OBSERVATIONS : has
  SOURCES ||--o{ INGESTION_RUNS : starts
  INGESTION_RUNS ||--o{ IMPORT_ERRORS : reports
  LISTINGS {
    text id PK
    text intent
    text property_type
    text city
    real area_sqm
    int rooms
    int sale_price
    int rent_price
    int deposit_price
    text freshness_status
    datetime last_seen_at
  }
  SOURCES {
    text id PK
    text name
    text kind
    boolean enabled
    text permission_status
  }
  LISTING_OBSERVATIONS {
    text id PK
    text listing_id FK
    text source_id FK
    text source_record_id
    text content_hash
    datetime observed_at
  }
  INGESTION_RUNS {
    text id PK
    text source_id FK
    text status
    int accepted_count
    int rejected_count
    int duplicate_count
  }
  IMPORT_ERRORS {
    text id PK
    text run_id FK
    int row_number
    text error_code
    text safe_message
  }
```

## Data flow

```mermaid
flowchart LR
  input[Demo fixture or manual import] --> validate[Validate schema and limits]
  validate -->|invalid| rejected[Row error / rejected count]
  validate -->|valid| normalize[Normalize allowed fields]
  normalize --> identity[Resolve source identity and duplicate candidates]
  identity -->|new| canonical[Create or update canonical listing]
  identity -->|duplicate| reconcile[Reconcile fields and keep observation]
  canonical --> observe[Persist observation and run counts]
  reconcile --> observe
  observe --> db[(D1)]
  db --> search[Search candidates]
  search --> rank[Filter, score, add reasons and freshness]
  rank --> results[API response]
```

## Workflow: authorized ingestion

```mermaid
flowchart TD
  start([Start run]) --> source{Demo/manual or approved adapter?}
  source -- No --> deny[Fail closed; record permission error]
  deny --> end1([End])
  source -- Yes --> run[Create ingestion run]
  run --> fetch[Read fixture, file, or permitted source]
  fetch --> limits{Within size, row, and rate limits?}
  limits -- No --> fail[Fail safely and record sanitized error]
  limits -- Yes --> parse[Parse and validate each row]
  parse --> normalize[Normalize allowlisted fields]
  normalize --> dedupe[Match source ID and duplicate candidates]
  dedupe --> persist[Transactionally persist listing and observation]
  persist --> summary[Store counts and finish status]
  fail --> summary
  summary --> end2([End])
```

## Workflow: recommendation

```mermaid
flowchart TD
  criteria[Validated seeker criteria] --> hard[Apply hard constraints]
  hard --> candidates[Candidate set]
  candidates --> known[Evaluate known fields]
  known --> score[Compute bounded score]
  score --> reasons[Emit stable reason codes]
  reasons --> freshness[Attach freshness and provenance]
  freshness --> stable[Stable sort and pagination]
  stable --> client[Render Persian labels and unknown values]
```
