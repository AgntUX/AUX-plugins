# e14-ingest-missing-proposed-schema

Fixture for the marketplace linter test suite. The plugin slug ends in `-ingest`
but the `listing.yaml` does not declare a `proposed_schema` block. The linter
must emit E14 for this fixture so ingest-plugin authors get a clear error
explaining why the data-architect install review needs the block.
