#include <string.h>
#include <sotc/sotc.h>
#include <sotc/model.h>
#include <json.h>
#include "nala.h"
#include "common.h"

TEST(version)
{
    printf("SOTC Library version: %s\n", sotc_library_version());
}

TEST(load_model)
{
    int rc;
    struct sotc_model *model;

    rc = sotc_model_load(SOTC_TEST_SRC"test1.sotc", &model);
    ASSERT_EQ(rc, SOTC_OK);

    printf("Model load %i\n", rc);

    json_object_object_foreach(model->jroot, key, val)
    {
        printf("%s: %s\n", key, json_object_get_string(val));
    }


    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);
}
