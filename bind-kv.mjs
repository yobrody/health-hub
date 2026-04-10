// Binds the FRIDGE_META KV namespace to the health-hub Pages project
// via the Cloudflare API — avoids needing wrangler.toml which broke SSL.

const ACCOUNT_ID = '1b41f11c87339617385ae853f5313e83';
const PROJECT_NAME = 'health-hub';
const KV_NAMESPACE_ID = '38dfa4fbc0a84e178e0dc688093be7a4';
const TOKEN = 'lhxgKqWpMJKA6yKzbpJG0AsXBCy3DOsKiwhX6zV5Bik.Ewb9l73x9hq_lxQ2fW6PCOTVfAxJPH1OSR2lE7kpzAs';

async function bindKV() {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT_NAME}`;

  // First, fetch the current project config
  const getRes = await fetch(url, {
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  });
  const project = await getRes.json();
  if (!project.success) {
    console.error('Failed to fetch project:', JSON.stringify(project.errors));
    return;
  }
  console.log('Current production KV bindings:', 
    JSON.stringify(project.result?.deployment_configs?.production?.kv_namespaces || {}));

  // PATCH with FRIDGE_META KV binding for both production and preview
  const patchRes = await fetch(url, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deployment_configs: {
        production: {
          kv_namespaces: {
            FRIDGE_META: { namespace_id: KV_NAMESPACE_ID },
          },
        },
        preview: {
          kv_namespaces: {
            FRIDGE_META: { namespace_id: KV_NAMESPACE_ID },
          },
        },
      },
    }),
  });

  const result = await patchRes.json();
  if (result.success) {
    const bound = result.result?.deployment_configs?.production?.kv_namespaces;
    console.log('✅ KV binding applied successfully!');
    console.log('Production KV bindings now:', JSON.stringify(bound));
  } else {
    console.error('❌ Failed to bind KV:', JSON.stringify(result.errors));
    console.log('Full response:', JSON.stringify(result, null, 2));
  }
}

bindKV().catch(console.error);
