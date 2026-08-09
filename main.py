from render_sdk import Workflows
from tasks import app as task_app

app = Workflows.from_workflows(task_app)

if __name__ == "__main__":
    app.start()
