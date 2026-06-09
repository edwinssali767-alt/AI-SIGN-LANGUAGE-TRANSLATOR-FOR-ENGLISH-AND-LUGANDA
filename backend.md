Incase of an error in the backend
refer to the version of python
latest version of python is 3.14 and yet tensorflow is compatible with 3.12 
first type (dir)
assess the files to check whether there is venv
if it is                          (Remove-Item -Recurse -Force venv)
restart with proper version using py -3.12 -m venv venv
activate the virtual environment venv\Scripts\activate
assess the version               python --version
upgrade the pip                  python -m pip install --upgrade pip
first install numpy              pip install numpy
test numpy(output is version)    python -c "import numpy; print(numpy.__version__)"
then install the requirements    pip install -r requirements.txt
first install(if missing)        pip install pytz
then first run                   python app.py
no module named pytz             pip install pytz
no joblib in requrirements       pip install joblib