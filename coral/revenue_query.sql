SELECT
  pd.id                                                           AS incident_id,
  pd.title                                                        AS incident_name,
  pd.incident__service                                            AS service,
  pd.urgency                                                      AS urgency,
  pd.created_at                                                   AS created_at,

  COUNT(DISTINCT s.id)                                            AS affected_customers,

  -- Use json_get_float() to extract directly as a numeric value
  SUM(json_get_float(s.metadata, 'mrr'))                          AS monthly_mrr_at_risk,

  -- hourly burn rate: MRR / 730 hours per month
  ROUND(SUM(json_get_float(s.metadata, 'mrr')) / 730.0, 2)        AS burn_per_hour,

  -- revenue lost so far: prorate MRR to elapsed seconds
  ROUND(
    SUM(json_get_float(s.metadata, 'mrr')) / 730.0 / 3600.0
    * EXTRACT(EPOCH FROM (NOW() - pd.created_at::TIMESTAMP))
  , 2)                                                            AS revenue_lost_so_far,

  -- top 5 customers by MRR for the agent to reference
  ARRAY_AGG(s.email ORDER BY json_get_float(s.metadata, 'mrr') DESC)[1:5] AS top_customer_emails

FROM pagerduty.incidents pd
JOIN stripe.customers s
  -- Use json_get_str() to extract string for the JOIN comparison
  ON json_get_str(s.metadata, 'service') = pd.incident__service
WHERE pd.status = 'triggered'
GROUP BY
  pd.id, pd.title, pd.incident__service, pd.urgency, pd.created_at
ORDER BY monthly_mrr_at_risk DESC;
