export function createBackendDockerSmokeIdentity({
  integrationComposeProjectName,
  repositoryHash,
  processId,
  postgresVolumeKey = 'postgres_18_test_data',
}) {
  if (!/^[a-f0-9]{12}$/.test(repositoryHash)) {
    throw new Error('Backend Docker smoke repository hash must be 12 lowercase hexadecimal characters')
  }
  if (!Number.isSafeInteger(processId) || processId < 1) {
    throw new Error('Backend Docker smoke process ID must be a positive integer')
  }

  const composeProjectName = `vibecoding-template-backend-smoke-${repositoryHash}-${processId}`
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(composeProjectName)) {
    throw new Error('Backend Docker smoke generated an invalid Compose project name')
  }
  if (composeProjectName === integrationComposeProjectName) {
    throw new Error('Backend Docker smoke must not reuse the integration Compose project')
  }

  return {
    composeProjectName,
    networkName: `${composeProjectName}_default`,
    postgresVolumeName: `${composeProjectName}_${postgresVolumeKey}`,
  }
}
