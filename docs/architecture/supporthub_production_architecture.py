"""SupportHub Group 12 - final production architecture (target deployment).

Render (no local install needed):
  docker run --rm -v "<repo>/docs/architecture:/work" -w /work python:3.12-slim sh -c \
    "apt-get update -qq && apt-get install -y -qq graphviz >/dev/null && pip install -q diagrams && python supporthub_production_architecture.py"

Produces supporthub_production_architecture.{png,svg,pdf}.
Only PRODUCTION components are shown (no development, isolated or load-test copies).
Every edge is a communication path present in the code; labels state what it does.
"""
from diagrams import Cluster, Diagram, Edge
from diagrams.aws.compute import ECS, Lambda
from diagrams.aws.database import Dynamodb
from diagrams.aws.integration import SimpleNotificationServiceSns, SimpleQueueServiceSqs
from diagrams.aws.management import Cloudwatch
from diagrams.aws.security import IAM, SecretsManager
from diagrams.aws.storage import SimpleStorageServiceS3
from diagrams.onprem.client import Users
from diagrams.onprem.database import Postgresql
from diagrams.onprem.network import Internet
from diagrams.programming.language import Nodejs
from diagrams.saas.cdn import Cloudflare

GRAPH = {
    "fontsize": "30", "fontname": "Helvetica-Bold", "labelloc": "t", "pad": "0.8",
    "nodesep": "1.2", "ranksep": "1.4", "splines": "spline", "dpi": "170", "newrank": "true",
}
NODE = {"fontsize": "15", "fontname": "Helvetica"}
EDGE = {"fontsize": "12", "fontname": "Helvetica", "penwidth": "1.6", "arrowsize": "0.9"}

HTTPS = "#1f6feb"      # browser / API HTTPS
HMAC = "#8250df"       # HMAC-signed service-to-service
DB = "#1a7f37"         # PostgreSQL
AWSC = "#d4590b"       # AWS SDK calls (SigV4, component IAM key)
ASYNC = "#cf222e"      # asynchronous messaging
SEC = "#6e7781"        # secrets / IAM / logs


def e(label, color, style="solid"):
    return Edge(label=label, color=color, fontcolor=color, style=style)


with Diagram(
    "SupportHub Group 12 - Unified Production Architecture\n"
    "(one deployment: Cloudflare Pages -> 4 Vercel APIs -> Neon; AWS layer = Floci with ECS workers, started by infra/floci/start-supporthub.sh)",
    filename="supporthub_production_architecture", outformat=["png", "svg", "pdf"],
    show=False, direction="TB", graph_attr=GRAPH, node_attr=NODE, edge_attr=EDGE,
):
    users = Users("Readers, authors,\neditors (browser)")

    with Cluster("Cloudflare (edge)", graph_attr={"bgcolor": "#fff4e5", "fontsize": "20"}):
        pages = Cloudflare("Pages frontend +\nPages Function /api proxy")
        access = Cloudflare("Floci gateway Worker\n(*.workers.dev, service token)\n+ Workers VPC binding")
        turnstile = Internet("Turnstile siteverify\n(external API)")

    stackex = Internet("Stack Exchange API\n(external API)")

    with Cluster("Vercel (4 API microservices, HTTPS)", graph_attr={"bgcolor": "#f2f2f2", "fontsize": "20"}):
        identity = Nodejs("Identity Service\nlogin, sessions, RBAC\n(Alyaa - shared)")
        article = Nodejs("Article & Category\nService\n(Alyaa)")
        editorial = Nodejs("Editorial Service\nreview, publish, flags\n(Salma)")
        search = Nodejs("Search, Feedback &\nAnalytics Service\n(Nermeen)")

    neon = Postgresql("Neon PostgreSQL (production)\nrestricted role per service\nsessions, articles, outboxes,\nreviews, receipts, analytics")

    with Cluster("Floci host (Docker; must run during the demo; no inbound ports)\nstarted by infra/floci/start-supporthub.sh", graph_attr={"bgcolor": "#eef6ff", "fontsize": "20"}):
        tunnel = Internet("cloudflared\n(outbound Cloudflare Tunnel)")
        with Cluster("Floci AWS emulator (127.0.0.1 only + private Docker network)", graph_attr={"bgcolor": "#ffffff", "fontsize": "18"}):
            iam = IAM("IAM\nper-component users\n+ roles")
            secrets = SecretsManager("Secrets Manager\nruntime config +\ntask credentials")
            with Cluster("ECS cluster supporthub-workers", graph_attr={"bgcolor": "#fff8e6", "fontsize": "17"}):
                outbox_w = ECS("Article Outbox Worker\n(Alyaa)")
                consumer_w = ECS("Editorial Article\nConsumer (Salma)")
                pub_w = ECS("Editorial Publication\nWorker (Salma)")
            sqs = SimpleQueueServiceSqs("SQS\narticle-events")
            dlq = SimpleQueueServiceSqs("SQS DLQ")
            sns_pub = SimpleNotificationServiceSns("SNS\npublication-events")
            sns_alert = SimpleNotificationServiceSns("SNS\nsecurity-alerts")
            lam = Lambda("Lambda\npublication-outcome\n(Salma)")
            s3_backup = SimpleStorageServiceS3("S3 article-backups\n(Alyaa)")
            s3_export = SimpleStorageServiceS3("S3 analytics-exports\n(Nermeen)")
            ddb = Dynamodb("DynamoDB\nsearch-counters\n(Nermeen)")
            cw = Cloudwatch("CloudWatch\nmetrics (Search)\nLogs (Lambda)")

    # --- browser and edge
    users >> e("HTTPS pages + /api calls", HTTPS) >> pages
    pages >> e("HTTPS login, register, CSRF, me", HTTPS) >> identity
    pages >> e("HTTPS article CRUD, versions,\nsubmission", HTTPS) >> article
    pages >> e("HTTPS review, approve/reject,\npublish, flags", HTTPS) >> editorial
    pages >> e("HTTPS search, view, votes,\nfeedback, analytics", HTTPS) >> search
    identity >> e("verify Turnstile token", HTTPS, "dashed") >> turnstile
    search >> e("verify Turnstile token", HTTPS, "dashed") >> turnstile
    article >> e("related questions lookup", HTTPS, "dashed") >> stackex

    # --- database
    identity >> e("users, shared sessions,\naudit log", DB) >> neon
    article >> e("save article + transactional\noutbox (same commit)", DB) >> neon
    editorial >> e("reviews, history, flags,\npublication outbox", DB) >> neon
    search >> e("index, views, votes,\nfeedback + sentiment", DB) >> neon

    # --- service to service (HMAC)
    editorial >> e("HMAC status transition +\narticle lookup", HMAC) >> article
    editorial >> e("HMAC publication indexing", HMAC) >> search
    search >> e("HMAC fetch published article", HMAC) >> article

    # --- Vercel -> Floci (direct SDK calls through Access + Tunnel)
    article >> e("SDK S3 calls + service token", AWSC) >> access
    search >> e("SDK DynamoDB/S3/CloudWatch\n+ service token", AWSC) >> access
    identity >> e("SDK SNS Publish + service token", AWSC) >> access
    access >> e("token-checked requests only\n(Workers VPC -> tunnel)", AWSC) >> tunnel
    tunnel >> e("PutObject / GetObject backups", AWSC) >> s3_backup
    tunnel >> e("PutObject / GetObject CSV exports", AWSC) >> s3_export
    tunnel >> e("UpdateItem / Scan counters", AWSC) >> ddb
    tunnel >> e("PutMetricData", AWSC) >> cw
    tunnel >> e("Publish security alert", AWSC) >> sns_alert

    # --- asynchronous pipeline (ECS workers)
    outbox_w >> e("claim pending submission events", DB) >> neon
    outbox_w >> e("SendMessage article.submitted", ASYNC) >> sqs
    consumer_w >> e("ReceiveMessage; DeleteMessage\nafter DB commit", ASYNC) >> sqs
    sqs >> e("redrive after 5 receives", ASYNC, "dashed") >> dlq
    consumer_w >> e("inbox + pending review", DB) >> neon
    consumer_w >> e("HMAC author lookup", HMAC) >> article
    pub_w >> e("claim publication events", DB) >> neon
    pub_w >> e("Publish editorial.publication.published", ASYNC) >> sns_pub
    sns_pub >> e("invoke (async, retried)", ASYNC) >> lam
    lam >> e("persist publication receipt\n(idempotent)", DB) >> neon
    lam >> e("invocation logs", SEC, "dashed") >> cw

    # --- security plane
    [outbox_w, consumer_w, pub_w] >> e("load secrets", SEC, "dashed") >> secrets
    # IAM is not a communication endpoint: Floci evaluates the IAM policy of the
    # signing identity on every SDK call above (shown as a node, no arrow).
