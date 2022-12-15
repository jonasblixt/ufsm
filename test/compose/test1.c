#include <string.h>
#include <ufsm/model.h>
#include <json.h>
#include "../nala.h"
#include "common.h"

TEST(version)
{
    printf("uFSM Library version: %s\n", ufsmm_library_version());
}

TEST(load_model)
{
    int rc;
    struct ufsmm_model *model;

    rc = ufsmm_model_load(UFSMM_TEST_SRC"test1.ufsm", &model);
    ASSERT_EQ(rc, UFSMM_OK);

    printf("Model load %i\n", rc);

    json_object_object_foreach(model->jroot, key, val)
    {
        printf("%s: %s\n", key, json_object_get_string(val));
    }


    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);
}
