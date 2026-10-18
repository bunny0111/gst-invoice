# Logos move from files on disk into the database (see accounts/logo.py).
# Order matters: create the table, add the link, COPY any existing logo files in, and only then drop the old column.

import hashlib
import mimetypes

import django.db.models.deletion
from django.db import migrations, models


def copy_files_into_database(apps, schema_editor):
    Profile = apps.get_model("accounts", "BusinessProfile")
    LogoImage = apps.get_model("accounts", "LogoImage")
    from django.core.files.storage import default_storage

    for profile in Profile.objects.all():
        name = profile.logo.name if profile.logo else ""
        if not name:
            continue
        try:
            with default_storage.open(name, "rb") as handle:
                raw = handle.read()
        except Exception:  # file already gone (e.g. an ephemeral disk was wiped) - that business simply has no logo
            continue
        digest = hashlib.sha256(raw).hexdigest()
        image = LogoImage.objects.filter(sha256=digest).first() or LogoImage.objects.create(
            data=raw, sha256=digest, content_type=mimetypes.guess_type(name)[0] or "image/png",
        )
        profile.logo_image = image
        profile.save(update_fields=["logo_image"])


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='LogoImage',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('data', models.BinaryField()),
                ('content_type', models.CharField(default='image/png', max_length=20)),
                ('sha256', models.CharField(db_index=True, max_length=64)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
        ),
        migrations.AddField(
            model_name='businessprofile',
            name='logo_image',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='accounts.logoimage'),
        ),
        migrations.RunPython(copy_files_into_database, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name='businessprofile',
            name='logo',
        ),
    ]
