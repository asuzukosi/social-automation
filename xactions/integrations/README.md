# integrations/

Adapters that expose XActions inside other automation platforms.

- `n8n/`: the `n8n-nodes-xactions` community package (an `XActions` action node and an `XActionsTrigger` polling node) that calls a running XActions API.

Build and link the n8n node:

    cd integrations/n8n && npm install && npm run build
    npm link && cd ~/.n8n && npm link n8n-nodes-xactions

Set the XActions API URL and token as n8n credentials, then use the nodes in any workflow.
