# Ban-wave ASN concentration

The ban-waves response includes optional `asnClusters`, `asnKnownNodes` and
`asnUnknownNodes` fields on each wave. A cluster counts distinct affected node
identities after wave deduplication, not IP addresses or repeated observations.
`sharePct` uses all affected wave nodes as its denominator, including unknown
ASNs. Invalid/missing ASN values remain unknown. Conflicting organization labels
produce a null label rather than a guessed organization.

The expanded wave card shows clusters with at least two affected nodes and the
known/unknown coverage. Existing historical/live enrichment supplies the ASN;
it does not independently prove the ASN at the ban time. ASN concentration is
correlation, not evidence of a common operator or ban cause. Severity scoring
remains unchanged. No extra collector or provider lookup is introduced.
