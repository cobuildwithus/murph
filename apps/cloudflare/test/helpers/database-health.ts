export function buildMetricsBody(input: {
  branchId: string;
  clientWaitSeconds?: number;
  directErrors?: number;
  pooledErrors?: number;
  postgresStates?: Readonly<Record<string, number>>;
  serverConnections?: number;
}): string {
  const branchLabels =
    `planetscale_database_branch_id="${input.branchId}",`
    + 'planetscale_pod="pod-primary",planetscale_role="primary"';
  const postgresStates = input.postgresStates ?? {
    active: 5,
    idle: 5,
  };
  const stateLines = Object.entries(postgresStates).map(
    ([state, value]) =>
      "planetscale_postgres_connection_state{"
      + `${branchLabels},planetscale_connection_state="${state}"} ${value}`,
  );

  return [
    "# HELP planetscale_postgres_connection_state test",
    ...stateLines,
    `planetscale_postgres_settings_max_connections{${branchLabels}} 50`,
    "planetscale_pgbouncer_current_connections{"
      + `${branchLabels},planetscale_container="pgbouncer"} `
      + `${input.serverConnections ?? 10}`,
    "planetscale_pgbouncer_pools_client{"
      + `${branchLabels},planetscale_pgbouncer_pool="waiting"} 3`,
    "planetscale_pgbouncer_pools_client_maxwait_seconds{"
      + `${branchLabels}} ${input.clientWaitSeconds ?? 0}`,
    "planetscale_pgbouncer_pools_server{"
      + `${branchLabels},planetscale_pgbouncer_pool="active"} 40`,
    "planetscale_pgbouncer_pools_server{"
      + `${branchLabels},planetscale_pgbouncer_pool="idle"} 6`,
    "planetscale_edge_postgres_connection_errors_total{"
      + `planetscale_database_branch_id="${input.branchId}",`
      + 'planetscale_port="5432",planetscale_region="us-east"} '
      + `${input.directErrors ?? 0}`,
    "planetscale_edge_postgres_connection_errors_total{"
      + `planetscale_database_branch_id="${input.branchId}",`
      + 'planetscale_port="6432",planetscale_region="us-east"} '
      + `${input.pooledErrors ?? 0}`,
    "",
  ].join("\n");
}
